import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { RecorderRecord } from "@pendix/recorder"
import { getGraderTierConfig } from "@pendix/shared/models"
import {
  PromptGradeSchema,
  SESSION_NOTES_MAX_WORDS,
  SessionNotesSchema,
  UnderstandingScoreSchema,
  countWords,
} from "@pendix/shared/rubric"
import { describe, expect, it } from "vitest"
import {
  FakeModel,
  GraderValidationError,
  buildDefaultBatchResponse,
  gradeSession,
  loadGradeInstructions,
  type FakeModelCall,
} from "../src/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const goldenPath = path.resolve(here, "../../../golden/golden-prompts.json")

interface GoldenPromptEntry {
  readonly id: string
  readonly prompt: string
  readonly worked_example: boolean
}

function makeSessionRecords(promptCount: number, options?: { readonly includeTeachQA?: boolean }): RecorderRecord[] {
  const sessionId = `ses_test_${promptCount}`
  const baseTime = new Date("2026-11-26T10:00:00.000Z").getTime()
  const records: RecorderRecord[] = [
    {
      type: "start",
      session_id: sessionId,
      time: new Date(baseTime).toISOString(),
      project_name: "pendix-demo-app",
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: Boolean(options?.includeTeachQA),
    },
  ]

  for (let i = 0; i < promptCount; i += 1) {
    const promptTime = new Date(baseTime + (i * 2 + 1) * 1000).toISOString()
    const turnTime = new Date(baseTime + (i * 2 + 2) * 1000).toISOString()
    records.push({
      type: "prompt",
      session_id: sessionId,
      time: promptTime,
      text: `Step ${i + 1}: update src/feature-${i + 1}.ts to add validation and run tests.`,
      files: [`src/feature-${i + 1}.ts`],
    })
    records.push({
      type: "turn",
      session_id: sessionId,
      time: turnTime,
      tools: { read: 1, edit: 1 },
      files_changed: [{ path: `src/feature-${i + 1}.ts`, lines_added: 12, lines_removed: 2 }],
      commands: ["vitest"],
      errored: false,
      reply_preview: `Updated src/feature-${i + 1}.ts and confirmed tests pass.`,
    })
  }

  if (options?.includeTeachQA) {
    records.push({
      type: "teach_qa",
      session_id: sessionId,
      time: new Date(baseTime + promptCount * 2000 + 5000).toISOString(),
      question: "Why do we validate request payloads on the server as well as in the browser?",
      answer: "Because clients can send raw HTTP requests directly and bypass browser validation.",
    })
  }

  records.push({
    type: "end",
    session_id: sessionId,
    time: new Date(baseTime + promptCount * 2000 + 10000).toISOString(),
    reason: "quit",
  })

  return records
}

describe("@pendix/grader", () => {
  it("grades a 3-prompt session with FakeModel and returns 3 valid grades, understanding score, and notes under 250 words", async () => {
    const records = makeSessionRecords(3, { includeTeachQA: true })
    const primary = new FakeModel()
    const fallback = new FakeModel()

    const result = await gradeSession(records, "subscriber", {
      modelFactory: (spec) => (spec.provider === "google" ? primary.asLanguageModel(spec) : fallback.asLanguageModel(spec)),
    })

    const expectedPrimary = getGraderTierConfig("subscriber").primary
    expect(result.tier).toBe("subscriber")
    expect(result.batch_count).toBe(1)
    expect(result.model_used).toEqual(expectedPrimary)
    expect(primary.calls).toHaveLength(1)
    expect(fallback.calls).toHaveLength(0)

    expect(result.prompts).toHaveLength(3)
    for (let i = 0; i < 3; i += 1) {
      const grade = result.prompts[i]!
      expect(grade.prompt_index).toBe(i)
      expect(() => PromptGradeSchema.parse(grade)).not.toThrow()
      expect(grade.model_used).toEqual(expectedPrimary)
    }

    expect(() => UnderstandingScoreSchema.parse(result.understanding)).not.toThrow()
    expect(() => SessionNotesSchema.parse(result.notes)).not.toThrow()
    expect(result.notes.things_learned).toHaveLength(3)
    expect(result.notes.things_to_work_on).toHaveLength(2)
    expect(countWords(result.notes.summary)).toBeLessThan(SESSION_NOTES_MAX_WORDS)
  })

  it("retries primary once then uses and records the fallback model when primary throws", async () => {
    const records = makeSessionRecords(3)
    const primary = new FakeModel({
      onGenerate: () => {
        throw new Error("Primary provider 503 unavailable")
      },
    })
    const fallback = new FakeModel()

    const result = await gradeSession(records, "credit", {
      modelFactory: (spec) =>
        spec.provider === "deepseek" ? primary.asLanguageModel(spec) : fallback.asLanguageModel(spec),
    })

    const tierConfig = getGraderTierConfig("credit")
    // Primary tried once + retried once = 2 attempts before falling back.
    expect(primary.calls).toHaveLength(2)
    expect(fallback.calls).toHaveLength(1)
    expect(result.model_used).toEqual(tierConfig.fallback)
    expect(result.prompts).toHaveLength(3)
    for (const grade of result.prompts) {
      expect(grade.model_used).toEqual(tierConfig.fallback)
    }
  })

  it("retries once with the validation error appended when output is invalid then valid", async () => {
    const records = makeSessionRecords(3)
    let attempt = 0
    const primary = new FakeModel({
      onGenerate: (call: FakeModelCall) => {
        attempt += 1
        if (attempt === 1) {
          // Invalid: total does not match sum of criterion scores, and score 5 exceeds max 2.
          return {
            prompts: [
              {
                prompt_index: 0,
                scores: { goal: 5, context: 1, constraints: 1, verification: 1, steps: 1 },
                reasons: {
                  goal: "bad",
                  context: "ok",
                  constraints: "ok",
                  verification: "ok",
                  steps: "ok",
                },
                total: 2,
                improved_prompt: "Better prompt",
                confidence: 0.9,
              },
            ],
            understanding: { score: 8, reason: "Understands core flow." },
            notes: {
              what_was_built: "Built validation.",
              things_learned: ["One", "Two", "Three"],
              things_to_work_on: ["Four", "Five"],
              summary: "Built validation.",
            },
          }
        }
        return buildDefaultBatchResponse(call)
      },
    })

    const result = await gradeSession(records, "subscriber", {
      modelFactory: (spec) => primary.asLanguageModel(spec),
    })

    expect(primary.calls).toHaveLength(2)
    expect(primary.calls[1]!.prompt).toContain("validation")
    expect(result.prompts).toHaveLength(3)
  })

  it("fails cleanly with GraderValidationError when both validation attempts are invalid", async () => {
    const records = makeSessionRecords(2)
    const primary = new FakeModel({
      onGenerate: () => ({ invalid: true }),
    })

    await expect(
      gradeSession(records, "credit", {
        modelFactory: (spec) => primary.asLanguageModel(spec),
      }),
    ).rejects.toBeInstanceOf(GraderValidationError)
    // Attempt 1 + 1 validation retry = 2 calls, does not silently succeed.
    expect(primary.calls).toHaveLength(2)
  })

  it("grades a 40-prompt session in exactly 3 batches and merges all 40 grades in order", async () => {
    const records = makeSessionRecords(40, { includeTeachQA: true })
    const primary = new FakeModel()

    const result = await gradeSession(records, "subscriber", {
      modelFactory: (spec) => primary.asLanguageModel(spec),
    })

    expect(result.batch_count).toBe(3)
    expect(primary.calls).toHaveLength(3)
    expect(result.prompts).toHaveLength(40)
    expect(result.prompts.map((p) => p.prompt_index)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(() => UnderstandingScoreSchema.parse(result.understanding)).not.toThrow()
    expect(() => SessionNotesSchema.parse(result.notes)).not.toThrow()
  })

  it("rejects session notes of 250 words or more and accepts notes under 250 words on retry", async () => {
    const records = makeSessionRecords(3)
    const tooLongSummary = Array.from({ length: 260 }, (_, i) => `word${i}`).join(" ")
    let attempt = 0
    const primary = new FakeModel({
      onGenerate: (call) => {
        attempt += 1
        const valid = buildDefaultBatchResponse(call)
        if (attempt === 1 && valid.notes) {
          return {
            ...valid,
            notes: {
              ...valid.notes,
              summary: tooLongSummary,
            },
          }
        }
        return valid
      },
    })

    const result = await gradeSession(records, "subscriber", {
      modelFactory: (spec) => primary.asLanguageModel(spec),
    })

    expect(primary.calls).toHaveLength(2)
    expect(countWords(result.notes.summary)).toBeLessThan(SESSION_NOTES_MAX_WORDS)
  })

  it("falls back when the primary model times out", async () => {
    const records = makeSessionRecords(2)
    const primary = new FakeModel({
      onGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("Request timed out")),
            { once: true },
          )
        }),
    })
    const fallback = new FakeModel()

    const result = await gradeSession(records, "subscriber", {
      timeoutMs: 30,
      modelFactory: (spec) =>
        spec.provider === "google" ? primary.asLanguageModel(spec) : fallback.asLanguageModel(spec),
    })

    const tierConfig = getGraderTierConfig("subscriber")
    expect(primary.calls).toHaveLength(2)
    expect(fallback.calls).toHaveLength(1)
    expect(result.model_used).toEqual(tierConfig.fallback)
  })

  it("includes the rubric and only the 6 worked_example golden prompts in grade.md", () => {
    const instructions = loadGradeInstructions()
    const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenPromptEntry[]
    const worked = golden.filter((g) => g.worked_example)
    const heldOut = golden.filter((g) => !g.worked_example)

    expect(worked).toHaveLength(6)
    expect(heldOut).toHaveLength(34)

    // No em dashes or en dashes in instructions.
    expect(instructions).not.toContain("\u2014")
    expect(instructions).not.toContain("\u2013")

    for (const item of worked) {
      expect(instructions).toContain(item.prompt)
    }
    for (const item of heldOut) {
      expect(instructions).not.toContain(item.prompt)
    }
  })
})

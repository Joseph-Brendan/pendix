import type { GraderModelSpec } from "@pendix/shared/models"
import type { LanguageModel } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import {
  ASSESSMENT_MARK_PROMPT_MARKER,
  WEEKLY_RECORDS_PROMPT_MARKER,
  type BuildAssessmentOutput,
  type MarkAssessmentOutput,
} from "./assessment.js"
import type { BatchGradeOutput } from "./schemas.js"

export interface FakeModelCall {
  readonly spec: GraderModelSpec
  readonly system: string
  readonly prompt: string
  readonly abortSignal?: AbortSignal
  readonly attempt: number
}

export type FakeModelHandler = (call: FakeModelCall) => unknown | Promise<unknown>

export interface FakeModelOptions {
  readonly onGenerate?: FakeModelHandler
  readonly responses?: readonly unknown[]
}

interface ParsedBatchPayload {
  readonly prompt_indices?: number[]
  readonly include_session_summary?: boolean
  readonly session_overview?: {
    readonly project_name?: string
    readonly teach_qa?: readonly { readonly question: string; readonly answer: string }[]
  }
}

function parseBatchPayloadFromPrompt(prompt: string): ParsedBatchPayload {
  const marker = "Session batch data (JSON):\n"
  const idx = prompt.indexOf(marker)
  if (idx === -1) return {}
  const afterMarker = prompt.slice(idx + marker.length)
  // If a validation retry appended text after the JSON block, extract the JSON object cleanly.
  const retryMarker = "\n\nYour previous response failed structured output validation"
  const jsonText = afterMarker.includes(retryMarker)
    ? afterMarker.slice(0, afterMarker.indexOf(retryMarker))
    : afterMarker
  try {
    return JSON.parse(jsonText) as ParsedBatchPayload
  } catch {
    return {}
  }
}

export function buildDefaultBatchResponse(call: FakeModelCall): BatchGradeOutput {
  const parsed = parseBatchPayloadFromPrompt(call.prompt)
  const indices = Array.isArray(parsed.prompt_indices) ? parsed.prompt_indices : [0]

  const prompts = indices.map((promptIndex) => ({
    prompt_index: promptIndex,
    scores: {
      goal: 2,
      context: 2,
      constraints: 1,
      verification: 2,
      steps: 2,
    },
    reasons: {
      goal: "States a clear, concrete feature outcome.",
      context: "Names the target file to update.",
      constraints: "Implies keeping the change focused, though limits could be firmer.",
      verification: "Asks to run tests to confirm the change.",
      steps: "Scoped cleanly to one step.",
    },
    total: 9,
    improved_prompt: `Update the target file for step ${promptIndex + 1}, keep existing exports unchanged, and show the passing test output.`,
    confidence: 0.91,
  }))

  if (!parsed.include_session_summary) {
    return { prompts }
  }

  const projectName = parsed.session_overview?.project_name || "the project"
  const hasTeachQA = (parsed.session_overview?.teach_qa?.length ?? 0) > 0

  return {
    prompts,
    understanding: {
      score: hasTeachQA ? 8 : 7,
      reason: hasTeachQA
        ? "Answered teach check questions accurately and verified changes with tests."
        : "Followed each step cleanly and checked results with tests.",
    },
    notes: {
      what_was_built: `Added validation updates and test coverage across ${projectName}.`,
      things_learned: [
        "Scope each prompt to a single clear change.",
        "Validate input on the server as well as the client.",
        "Run unit tests right after each edit.",
      ],
      things_to_work_on: [
        "State explicit constraints on what should not change.",
        "Include expected failure cases in verification steps.",
      ],
      summary: `You updated validation and tests in ${projectName}. You practiced scoping changes to one step, checking server input, and running tests after edits. Next session, add clearer do-not-touch constraints and include edge-case checks.`,
    },
  }
}

function extractPromptParts(promptMessages: ReadonlyArray<{ readonly role: string; readonly content: unknown }>): {
  system: string
  prompt: string
} {
  let system = ""
  const userParts: string[] = []

  for (const message of promptMessages) {
    if (message.role === "system" && typeof message.content === "string") {
      system = system ? `${system}\n${message.content}` : message.content
      continue
    }
    if (message.role === "user") {
      if (typeof message.content === "string") {
        userParts.push(message.content)
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
            const text = (part as { text?: unknown }).text
            if (typeof text === "string") userParts.push(text)
          }
        }
      }
    }
  }

  return { system, prompt: userParts.join("\n") }
}

function extractJsonBlockAfterMarker(prompt: string, marker: string): unknown | null {
  const idx = prompt.indexOf(marker)
  if (idx === -1) return null
  const afterMarker = prompt.slice(idx + marker.length)
  const retryMarker = "\n\nYour previous response failed structured output validation"
  const jsonText = afterMarker.includes(retryMarker)
    ? afterMarker.slice(0, afterMarker.indexOf(retryMarker))
    : afterMarker
  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return null
  }
}

export function buildDefaultAssessmentResponse(call: FakeModelCall): BuildAssessmentOutput | null {
  const raw = extractJsonBlockAfterMarker(call.prompt, WEEKLY_RECORDS_PROMPT_MARKER) as {
    readonly sessions?: readonly {
      readonly project_title?: string
      readonly files?: readonly string[]
    }[]
  } | null
  if (!raw || !Array.isArray(raw.sessions)) return null

  const targets: string[] = []
  for (const session of raw.sessions) {
    if (Array.isArray(session.files)) {
      for (const file of session.files) {
        if (typeof file === "string" && file.trim() && !targets.includes(file)) {
          targets.push(file)
        }
      }
    }
  }
  if (targets.length === 0) {
    for (const session of raw.sessions) {
      if (session.project_title) targets.push(session.project_title)
    }
  }
  const targetAt = (i: number) => targets[i % Math.max(1, targets.length)] ?? "project"

  const t0 = targetAt(0)
  const t1 = targetAt(1)
  const t2 = targetAt(2)
  const t3 = targetAt(3)
  const t4 = targetAt(4)

  return {
    questions: [
      {
        question_index: 0,
        question_kind: "why",
        reference_target: t0,
        prompt: `Why did the agent structure the change in ${t0} the way it did?`,
        reference_answer: `It kept the logic in ${t0} focused and verifiable with tests.`,
      },
      {
        question_index: 1,
        question_kind: "why",
        reference_target: t1,
        prompt: `Why did the agent add explicit guards when updating ${t1}?`,
        reference_answer: `To prevent invalid inputs or edge cases from failing silently in ${t1}.`,
      },
      {
        question_index: 2,
        question_kind: "what_would_break",
        reference_target: t2,
        prompt: `What would break if the validation check in ${t2} were removed?`,
        reference_answer: `Invalid state or bad input could pass through ${t2} unchecked.`,
      },
      {
        question_index: 3,
        question_kind: "how_to_check",
        reference_target: t3,
        prompt: `How would you check that your update to ${t3} still handles failure cases?`,
        reference_answer: `Write a targeted unit test for ${t3} covering invalid input and assert the failure path.`,
      },
      {
        question_index: 4,
        question_kind: "multiple_choice",
        reference_target: t4,
        prompt: `Which check best confirms the behavior you changed in ${t4}?`,
        choices: [
          `Running unit tests that assert the expected output of ${t4}`,
          `Skipping tests and checking only that the file saves`,
          `Removing type checks before running ${t4}`,
          `Ignoring errors returned by ${t4}`,
        ],
        reference_answer: `Running unit tests that assert the expected output of ${t4}`,
      },
    ],
  }
}

export function buildDefaultMarkAssessmentResponse(call: FakeModelCall): MarkAssessmentOutput | null {
  const raw = extractJsonBlockAfterMarker(call.prompt, ASSESSMENT_MARK_PROMPT_MARKER) as {
    readonly items?: readonly {
      readonly question_index: number
      readonly question_kind?: string
      readonly learner_answer?: string
      readonly reference_answer?: string
    }[]
  } | null
  if (!raw || !Array.isArray(raw.items)) return null

  const marks = raw.items.map((item) => {
    const answer = (item.learner_answer ?? "").trim()
    let score = 0
    if (item.question_kind === "multiple_choice") {
      score = answer && item.reference_answer && answer.toLowerCase() === item.reference_answer.toLowerCase() ? 2 : answer.length > 0 ? 1 : 0
    } else if (answer.length >= 20) {
      score = 2
    } else if (answer.length > 0) {
      score = 1
    }
    const feedback =
      score === 2
        ? "Clear and grounded answer."
        : score === 1
          ? "Partly right, add a bit more concrete detail from the file."
          : "Missing or unclear answer."
    return {
      question_index: item.question_index,
      score,
      feedback,
    }
  })

  const total = marks.reduce((sum, m) => sum + m.score, 0)
  return { marks, total }
}

function buildDefaultFakeResponse(call: FakeModelCall): unknown {
  const assessmentBuild = buildDefaultAssessmentResponse(call)
  if (assessmentBuild) return assessmentBuild
  const assessmentMark = buildDefaultMarkAssessmentResponse(call)
  if (assessmentMark) return assessmentMark
  return buildDefaultBatchResponse(call)
}

export class FakeModel {
  readonly calls: FakeModelCall[] = []
  private readonly handler: FakeModelHandler
  private responseCursor = 0

  constructor(options: FakeModelOptions = {}) {
    if (options.onGenerate) {
      this.handler = options.onGenerate
    } else if (options.responses) {
      const queue = [...options.responses]
      this.handler = (call) => {
        if (this.responseCursor >= queue.length) {
          return buildDefaultFakeResponse(call)
        }
        const next = queue[this.responseCursor]
        this.responseCursor += 1
        if (next instanceof Error) throw next
        return next
      }
    } else {
      this.handler = (call) => buildDefaultFakeResponse(call)
    }
  }

  asLanguageModel(spec: GraderModelSpec): LanguageModel {
    return new MockLanguageModelV4({
      provider: spec.provider,
      modelId: spec.model,
      doGenerate: async (options) => {
        const { system, prompt } = extractPromptParts(options.prompt)
        const call: FakeModelCall = {
          spec,
          system,
          prompt,
          abortSignal: options.abortSignal,
          attempt: this.calls.length + 1,
        }
        this.calls.push(call)

        const raw = await this.handler(call)
        const text = typeof raw === "string" ? raw : JSON.stringify(raw)

        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 100, text: 100, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
  }
}

import type { RecorderRecord } from "@pendix/recorder"
import { describe, expect, it } from "vitest"
import {
  FakeModel,
  buildAssessment,
  markAssessment,
  type AssessmentQuestion,
  type WeekSessionInput,
} from "../src/index.js"

function makeWeekSession(
  id: string,
  projectName: string,
  files: readonly string[],
  promptText: string,
): WeekSessionInput {
  const base = new Date("2026-11-24T10:00:00.000Z").getTime()
  const records: RecorderRecord[] = [
    {
      type: "start",
      session_id: id,
      time: new Date(base).toISOString(),
      project_name: projectName,
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: true,
    },
    {
      type: "prompt",
      session_id: id,
      time: new Date(base + 1000).toISOString(),
      text: promptText,
      files,
    },
    {
      type: "turn",
      session_id: id,
      time: new Date(base + 2000).toISOString(),
      tools: { read: 1, edit: 1 },
      files_changed: files.map((filePath) => ({ path: filePath, lines_added: 18, lines_removed: 4 })),
      commands: ["vitest"],
      errored: false,
      reply_preview: `Updated ${files.join(", ")} and confirmed the unit tests pass.`,
    },
    {
      type: "end",
      session_id: id,
      time: new Date(base + 3000).toISOString(),
      reason: "quit",
    },
  ]

  return {
    session_id: id,
    project_title: projectName,
    records,
  }
}

describe("@pendix/grader weekly assessments", () => {
  it("buildAssessment uses FakeModel on a 3-session week and returns 5 questions naming files from those sessions", async () => {
    const weekSessions: WeekSessionInput[] = [
      makeWeekSession(
        "ses_week_1",
        "invoice-api",
        ["src/auth/tokens.ts"],
        "Add refresh token rotation in src/auth/tokens.ts and test reuse rejection.",
      ),
      makeWeekSession(
        "ses_week_2",
        "invoice-api",
        ["src/billing/ledger.ts"],
        "Make src/billing/ledger.ts insert-only with row locking on spend.",
      ),
      makeWeekSession(
        "ses_week_3",
        "invoice-api",
        ["src/routes/invoices.ts"],
        "Validate invoice line totals in src/routes/invoices.ts using integer cents.",
      ),
    ]

    const fake = new FakeModel()
    const result = await buildAssessment(weekSessions, "subscriber", {
      modelFactory: (spec) => fake.asLanguageModel(spec),
    })

    expect(result.questions).toHaveLength(5)
    expect(result.model_used.provider).toBe("google")

    const kinds = result.questions.map((q) => q.question_kind)
    expect(kinds.filter((k) => k === "why")).toHaveLength(2)
    expect(kinds.filter((k) => k === "what_would_break")).toHaveLength(1)
    expect(kinds.filter((k) => k === "how_to_check")).toHaveLength(1)
    expect(kinds.filter((k) => k === "multiple_choice")).toHaveLength(1)

    const sessionFiles = ["src/auth/tokens.ts", "src/billing/ledger.ts", "src/routes/invoices.ts"]
    for (const q of result.questions) {
      const mentionsSessionFile = sessionFiles.some(
        (filePath) => q.prompt.includes(filePath) || q.reference_target.includes(filePath),
      )
      expect(mentionsSessionFile).toBe(true)
      expect(q.prompt.trim().length).toBeGreaterThan(10)
    }

    const mc = result.questions.find((q) => q.question_kind === "multiple_choice")!
    expect(mc.choices).toBeDefined()
    expect(mc.choices!.length).toBeGreaterThanOrEqual(3)
  })

  it("markAssessment scores each answer 0 to 2 with feedback and total equals sum of question scores", async () => {
    const questions: AssessmentQuestion[] = [
      {
        question_index: 0,
        question_kind: "why",
        reference_target: "src/auth/tokens.ts",
        prompt: "Why did the agent rotate refresh tokens in src/auth/tokens.ts?",
        reference_answer: "To limit damage if a stolen refresh token is replayed.",
      },
      {
        question_index: 1,
        question_kind: "why",
        reference_target: "src/billing/ledger.ts",
        prompt: "Why did the agent add a row lock in src/billing/ledger.ts?",
        reference_answer: "To prevent concurrent requests from double-spending the same balance.",
      },
      {
        question_index: 2,
        question_kind: "what_would_break",
        reference_target: "src/routes/invoices.ts",
        prompt: "What would break if src/routes/invoices.ts stored amounts as floats instead of cents?",
        reference_answer: "Rounding drift on totals and comparisons.",
      },
      {
        question_index: 3,
        question_kind: "how_to_check",
        reference_target: "src/billing/ledger.ts",
        prompt: "How would you check that concurrent spends in src/billing/ledger.ts cannot go negative?",
        reference_answer: "Run two simultaneous spend requests against a balance of 1 and assert only one succeeds.",
      },
      {
        question_index: 4,
        question_kind: "multiple_choice",
        reference_target: "src/auth/tokens.ts",
        prompt: "Which change in src/auth/tokens.ts catches a replayed refresh token?",
        choices: [
          "Rotating the token and rejecting any previously used token",
          "Increasing the JWT expiry to 30 days",
          "Logging the raw token to stdout",
          "Storing passwords in plain text",
        ],
        reference_answer: "Rotating the token and rejecting any previously used token",
      },
    ]

    const answers = [
      { question_index: 0, answer: "Rotating invalidates the old token so a stolen one cannot be reused." },
      { question_index: 1, answer: "It serializes concurrent requests so two spends cannot read the same balance." },
      { question_index: 2, answer: "Floating point rounding errors cause totals to mismatch." },
      { question_index: 3, answer: "Fire two parallel requests with balance 1 and verify one fails." },
      { question_index: 4, answer: "Rotating the token and rejecting any previously used token" },
    ]

    const fake = new FakeModel({
      onGenerate: () => ({
        marks: [
          { question_index: 0, score: 2, feedback: "Clear explanation of token replay protection." },
          { question_index: 1, score: 2, feedback: "Accurate explanation of concurrent balance locking." },
          { question_index: 2, score: 1, feedback: "Mentions rounding, could note failed equality checks." },
          { question_index: 3, score: 2, feedback: "Concrete concurrency test with clear assertion." },
          { question_index: 4, score: 2, feedback: "Correct option selected." },
        ],
        total: 9,
      }),
    })

    const marked = await markAssessment(questions, answers, "credit", {
      modelFactory: (spec) => fake.asLanguageModel(spec),
    })

    expect(marked.marks).toHaveLength(5)
    for (const mark of marked.marks) {
      expect(mark.score).toBeGreaterThanOrEqual(0)
      expect(mark.score).toBeLessThanOrEqual(2)
      expect(mark.feedback.trim().length).toBeGreaterThan(0)
    }
    const sum = marked.marks.reduce((acc, m) => acc + m.score, 0)
    expect(marked.total).toBe(sum)
    expect(marked.total).toBe(9)
    expect(marked.model_used.provider).toBe("deepseek")
  })
})

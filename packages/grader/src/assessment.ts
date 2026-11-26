import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { FileChangeSummary, RecorderRecord, StartRecord } from "@pendix/recorder"
import { getGraderTierConfig, type GraderModelSpec, type GraderTier } from "@pendix/shared/models"
import { z } from "zod"
import {
  GraderError,
  createDefaultModelFactory,
  runStructuredWithFallback,
  type GraderModelFactory,
} from "./models.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const ASSESSMENT_BUILD_PROMPT_PATH = path.resolve(here, "./prompts/assessment-build.md")
const ASSESSMENT_MARK_PROMPT_PATH = path.resolve(here, "./prompts/assessment-mark.md")

let cachedBuildInstructions: string | undefined
let cachedMarkInstructions: string | undefined

export function loadAssessmentBuildInstructions(): string {
  if (cachedBuildInstructions === undefined) {
    cachedBuildInstructions = readFileSync(ASSESSMENT_BUILD_PROMPT_PATH, "utf8").trim()
  }
  return cachedBuildInstructions
}

export function loadAssessmentMarkInstructions(): string {
  if (cachedMarkInstructions === undefined) {
    cachedMarkInstructions = readFileSync(ASSESSMENT_MARK_PROMPT_PATH, "utf8").trim()
  }
  return cachedMarkInstructions
}

export const ASSESSMENT_QUESTION_COUNT = 5

export const AssessmentQuestionKindSchema = z.enum(["why", "what_would_break", "how_to_check", "multiple_choice"])
export type AssessmentQuestionKind = z.infer<typeof AssessmentQuestionKindSchema>

export const AssessmentQuestionSchema = z
  .object({
    question_index: z.number().int().min(0).max(4),
    question_kind: AssessmentQuestionKindSchema,
    reference_target: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    choices: z.array(z.string().trim().min(1)).min(3).max(5).optional(),
    reference_answer: z.string().trim().min(1),
  })
  .superRefine((q, ctx) => {
    if (q.question_kind === "multiple_choice" && (!q.choices || q.choices.length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Multiple choice question must include at least 3 choices.",
      })
    }
  })

export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>

export const BuildAssessmentOutputSchema = z
  .object({
    questions: z.array(AssessmentQuestionSchema).length(ASSESSMENT_QUESTION_COUNT),
  })
  .superRefine((data, ctx) => {
    const counts: Record<AssessmentQuestionKind, number> = {
      why: 0,
      what_would_break: 0,
      how_to_check: 0,
      multiple_choice: 0,
    }
    const seen = new Set<number>()
    for (let i = 0; i < data.questions.length; i += 1) {
      const q = data.questions[i]!
      counts[q.question_kind] += 1
      if (seen.has(q.question_index)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "question_index"],
          message: `Duplicate question_index ${q.question_index}`,
        })
      }
      seen.add(q.question_index)
    }

    if (counts.why !== 2) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `Expected 2 "why" questions, got ${counts.why}`,
      })
    }
    if (counts.what_would_break !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `Expected 1 "what_would_break" question, got ${counts.what_would_break}`,
      })
    }
    if (counts.how_to_check !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `Expected 1 "how_to_check" question, got ${counts.how_to_check}`,
      })
    }
    if (counts.multiple_choice !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `Expected 1 "multiple_choice" question, got ${counts.multiple_choice}`,
      })
    }
  })

export type BuildAssessmentOutput = z.infer<typeof BuildAssessmentOutputSchema>

export const AssessmentQuestionMarkSchema = z.object({
  question_index: z.number().int().min(0).max(4),
  score: z.number().int().min(0).max(2),
  feedback: z.string().trim().min(1),
})

export type AssessmentQuestionMark = z.infer<typeof AssessmentQuestionMarkSchema>

export const MarkAssessmentOutputSchema = z
  .object({
    marks: z.array(AssessmentQuestionMarkSchema).length(ASSESSMENT_QUESTION_COUNT),
    total: z.number().int().min(0).max(10),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<number>()
    let sum = 0
    for (let i = 0; i < data.marks.length; i += 1) {
      const mark = data.marks[i]!
      sum += mark.score
      if (seen.has(mark.question_index)) {
        ctx.addIssue({
          code: "custom",
          path: ["marks", i, "question_index"],
          message: `Duplicate question_index ${mark.question_index}`,
        })
      }
      seen.add(mark.question_index)
    }
    if (data.total !== sum) {
      ctx.addIssue({
        code: "custom",
        path: ["total"],
        message: `Total (${data.total}) must equal sum of question scores (${sum})`,
      })
    }
  })

export type MarkAssessmentOutput = z.infer<typeof MarkAssessmentOutputSchema>

export type WeekSessionInput =
  | readonly RecorderRecord[]
  | {
      readonly session_id?: string
      readonly project_title?: string
      readonly records: readonly RecorderRecord[]
    }

export interface AssessmentAnswerInput {
  readonly question_index: number
  readonly answer: string
}

export interface AssessmentModelOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
  readonly timeoutMs?: number
}

export interface BuiltAssessmentResult {
  readonly tier: GraderTier
  readonly questions: readonly AssessmentQuestion[]
  readonly model_used: GraderModelSpec
}

export interface MarkedAssessmentResult {
  readonly tier: GraderTier
  readonly marks: readonly AssessmentQuestionMark[]
  readonly total: number
  readonly model_used: GraderModelSpec
}

interface SummarizedWeekSession {
  readonly session_id: string
  readonly project_title: string
  readonly files: readonly string[]
  readonly prompts: readonly { readonly text: string; readonly files: readonly string[] }[]
  readonly turns: readonly {
    readonly files_changed: readonly string[]
    readonly commands: readonly string[]
    readonly errored: boolean
    readonly reply_preview: string
  }[]
  readonly teach_qa: readonly { readonly question: string; readonly answer: string }[]
}

function summarizeWeekSession(input: WeekSessionInput, index: number): SummarizedWeekSession {
  const records = Array.isArray(input) ? input : (input as { readonly records: readonly RecorderRecord[] }).records
  const explicitId = Array.isArray(input) ? undefined : (input as { readonly session_id?: string }).session_id
  const explicitTitle = Array.isArray(input) ? undefined : (input as { readonly project_title?: string }).project_title

  let start: StartRecord | undefined
  const filesSet = new Set<string>()
  const prompts: Array<{ readonly text: string; readonly files: readonly string[] }> = []
  const turns: Array<{
    readonly files_changed: readonly string[]
    readonly commands: readonly string[]
    readonly errored: boolean
    readonly reply_preview: string
  }> = []
  const teachQA: Array<{ readonly question: string; readonly answer: string }> = []

  for (const record of records) {
    if (record.type === "start") {
      start = record
      continue
    }
    if (record.type === "prompt") {
      for (const f of record.files) filesSet.add(f)
      prompts.push({ text: record.text.slice(0, 400), files: record.files })
      continue
    }
    if (record.type === "turn") {
      const changed = record.files_changed.map((f: FileChangeSummary) => f.path)
      for (const f of changed) filesSet.add(f)
      turns.push({
        files_changed: changed,
        commands: record.commands,
        errored: record.errored,
        reply_preview: record.reply_preview.slice(0, 300),
      })
      continue
    }
    if (record.type === "teach_qa") {
      teachQA.push({ question: record.question, answer: record.answer })
    }
  }

  return {
    session_id: explicitId ?? start?.session_id ?? `session_${index + 1}`,
    project_title: explicitTitle ?? start?.project_name ?? "project",
    files: [...filesSet],
    prompts: prompts.slice(0, 20),
    turns: turns.slice(0, 20),
    teach_qa: teachQA.slice(0, 10),
  }
}

export const WEEKLY_RECORDS_PROMPT_MARKER = "Weekly session records (JSON):\n"
export const ASSESSMENT_MARK_PROMPT_MARKER = "Assessment answers to mark (JSON):\n"

export async function buildAssessment(
  weekRecords: readonly WeekSessionInput[],
  tier: GraderTier,
  options: AssessmentModelOptions = {},
): Promise<BuiltAssessmentResult> {
  if (weekRecords.length === 0) {
    throw new GraderError("EMPTY_WEEK", "At least one session record is required to build an assessment.")
  }

  const sessions = weekRecords.map((item, index) => summarizeWeekSession(item, index))
  const hasAnyContent = sessions.some((s) => s.prompts.length > 0 || s.turns.length > 0 || s.files.length > 0)
  if (!hasAnyContent) {
    throw new GraderError("EMPTY_WEEK", "Weekly session records contain no prompts or file changes.")
  }

  const tierConfig = getGraderTierConfig(tier, options.env)
  const modelFactory = options.modelFactory ?? createDefaultModelFactory(options.env)
  const system = loadAssessmentBuildInstructions()
  const prompt = [
    "Create 5 weekly assessment questions strictly from the learner's sessions below.",
    "Include 2 why questions, 1 what_would_break question, 1 how_to_check question, and 1 multiple_choice question.",
    "Name real files or features from these sessions in every question.",
    "",
    `${WEEKLY_RECORDS_PROMPT_MARKER}${JSON.stringify({ sessions }, null, 2)}`,
  ].join("\n")

  const { output, modelUsed } = await runStructuredWithFallback({
    tierConfig,
    modelFactory,
    system,
    prompt,
    schema: BuildAssessmentOutputSchema,
    timeoutMs: options.timeoutMs,
  })

  const sortedQuestions = [...output.questions].sort((a, b) => a.question_index - b.question_index)

  return {
    tier,
    questions: sortedQuestions,
    model_used: modelUsed,
  }
}

export async function markAssessment(
  questions: readonly Pick<
    AssessmentQuestion,
    "question_index" | "question_kind" | "reference_target" | "prompt" | "choices" | "reference_answer"
  >[],
  answers: readonly AssessmentAnswerInput[],
  tier: GraderTier,
  options: AssessmentModelOptions = {},
): Promise<MarkedAssessmentResult> {
  if (questions.length !== ASSESSMENT_QUESTION_COUNT) {
    throw new GraderError(
      "INVALID_ASSESSMENT",
      `Expected ${ASSESSMENT_QUESTION_COUNT} assessment questions, got ${questions.length}.`,
    )
  }

  const answerByIndex = new Map<number, string>()
  for (const item of answers) {
    answerByIndex.set(item.question_index, item.answer)
  }

  const items = [...questions]
    .sort((a, b) => a.question_index - b.question_index)
    .map((q) => ({
      question_index: q.question_index,
      question_kind: q.question_kind,
      reference_target: q.reference_target,
      prompt: q.prompt,
      ...(q.choices ? { choices: q.choices } : {}),
      reference_answer: q.reference_answer,
      learner_answer: answerByIndex.get(q.question_index) ?? "",
    }))

  const tierConfig = getGraderTierConfig(tier, options.env)
  const modelFactory = options.modelFactory ?? createDefaultModelFactory(options.env)
  const system = loadAssessmentMarkInstructions()
  const prompt = [
    "Mark each of the 5 learner answers from 0 to 2 with short plain-English feedback, and set total to their exact sum.",
    "",
    `${ASSESSMENT_MARK_PROMPT_MARKER}${JSON.stringify({ items }, null, 2)}`,
  ].join("\n")

  const { output, modelUsed } = await runStructuredWithFallback({
    tierConfig,
    modelFactory,
    system,
    prompt,
    schema: MarkAssessmentOutputSchema,
    timeoutMs: options.timeoutMs,
  })

  const sortedMarks = [...output.marks].sort((a, b) => a.question_index - b.question_index)

  return {
    tier,
    marks: sortedMarks,
    total: output.total,
    model_used: modelUsed,
  }
}

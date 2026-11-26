import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { FileChangeSummary, TeachQARecord, TurnRecord } from "@pendix/recorder"

const here = path.dirname(fileURLToPath(import.meta.url))
const GRADE_PROMPT_PATH = path.resolve(here, "./prompts/grade.md")

let cachedInstructions: string | undefined

export function loadGradeInstructions(): string {
  if (cachedInstructions === undefined) {
    cachedInstructions = readFileSync(GRADE_PROMPT_PATH, "utf8").trim()
  }
  return cachedInstructions
}

export interface SessionPromptItem {
  readonly prompt_index: number
  readonly time: string
  readonly text: string
  readonly files: readonly string[]
  readonly turn?: {
    readonly tools: Readonly<Record<string, number>>
    readonly files_changed: readonly FileChangeSummary[]
    readonly commands: readonly string[]
    readonly errored: boolean
    readonly reply_preview: string
  }
}

export interface SessionOverview {
  readonly project_name: string
  readonly session_model: string
  readonly teach_mode: boolean
  readonly total_prompts: number
  readonly total_turns: number
  readonly errored_turns: number
  readonly files_changed: readonly FileChangeSummary[]
  readonly teach_qa: readonly Pick<TeachQARecord, "question" | "answer" | "time">[]
  readonly reaction_samples: readonly {
    readonly prompt_index: number
    readonly prompt_text: string
    readonly previous_turn_errored: boolean
  }[]
}

export interface BatchPromptInput {
  readonly batchNumber: number
  readonly totalBatches: number
  readonly prompts: readonly SessionPromptItem[]
  readonly includeSessionSummary: boolean
  readonly overview?: SessionOverview
}

export function buildBatchPrompt(input: BatchPromptInput): string {
  const payload: Record<string, unknown> = {
    batch_number: input.batchNumber,
    total_batches: input.totalBatches,
    include_session_summary: input.includeSessionSummary,
    prompt_indices: input.prompts.map((item) => item.prompt_index),
    prompts: input.prompts,
  }

  if (input.includeSessionSummary && input.overview) {
    payload.session_overview = input.overview
  }

  const lines = [
    `Grade batch ${input.batchNumber} of ${input.totalBatches}.`,
    `Return structured JSON grading every prompt in this batch (${input.prompts.map((p) => p.prompt_index).join(", ")}).`,
  ]

  if (input.includeSessionSummary) {
    lines.push(
      "This is the final batch. Also include the session understanding score (0 to 10 with reason) and session notes (under 250 words: what_was_built, 3 things_learned, 2 things_to_work_on, and summary).",
    )
  } else {
    lines.push("Return only the prompt grades for this batch.")
  }

  lines.push("", "Session batch data (JSON):", JSON.stringify(payload, null, 2))
  return lines.join("\n")
}

export function summarizeTurn(turn: TurnRecord): NonNullable<SessionPromptItem["turn"]> {
  return {
    tools: turn.tools,
    files_changed: turn.files_changed,
    commands: turn.commands,
    errored: turn.errored,
    reply_preview: turn.reply_preview,
  }
}

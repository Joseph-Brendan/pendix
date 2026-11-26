import type { FileChangeSummary, RecorderRecord, StartRecord, TeachQARecord } from "@pendix/recorder"
import { getGraderTierConfig, type GraderModelSpec, type GraderTier } from "@pendix/shared/models"
import { GRADING_BATCH_SIZE, type SessionNotes, type UnderstandingScore } from "@pendix/shared/rubric"
import {
  GraderError,
  createDefaultModelFactory,
  runStructuredWithFallback,
  type GraderModelFactory,
} from "./models.js"
import {
  buildBatchPrompt,
  loadGradeInstructions,
  summarizeTurn,
  type SessionOverview,
  type SessionPromptItem,
} from "./prompt.js"
import { createBatchResponseSchema, type IndexedPromptGrade } from "./schemas.js"

export type GradeSessionRecordInput =
  | readonly RecorderRecord[]
  | {
      readonly records: readonly RecorderRecord[]
      readonly project_title?: string
      readonly model?: string
    }

export interface PromptGradeWithModel extends IndexedPromptGrade {
  readonly model_used: GraderModelSpec
}

export interface SessionGradeResult {
  readonly tier: GraderTier
  readonly prompts: readonly PromptGradeWithModel[]
  readonly understanding: UnderstandingScore
  readonly notes: SessionNotes
  readonly model_used: GraderModelSpec
  readonly models_used: readonly GraderModelSpec[]
  readonly batch_count: number
}

export interface GradeSessionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
  readonly timeoutMs?: number
  readonly batchSize?: number
}

function normalizeRecords(input: GradeSessionRecordInput): {
  readonly records: readonly RecorderRecord[]
  readonly projectTitle?: string
  readonly model?: string
} {
  if (Array.isArray(input)) {
    return { records: input }
  }
  const wrapped = input as {
    readonly records: readonly RecorderRecord[]
    readonly project_title?: string
    readonly model?: string
  }
  return {
    records: wrapped.records,
    projectTitle: wrapped.project_title,
    model: wrapped.model,
  }
}

function extractSessionItems(input: GradeSessionRecordInput): {
  readonly prompts: SessionPromptItem[]
  readonly overview: SessionOverview
} {
  const { records, projectTitle, model } = normalizeRecords(input)
  let start: StartRecord | undefined
  const prompts: Array<{
    prompt_index: number
    time: string
    text: string
    files: readonly string[]
    turn?: SessionPromptItem["turn"]
  }> = []
  const teachQA: Array<Pick<TeachQARecord, "question" | "answer" | "time">> = []
  const filesChangedMap = new Map<string, { added: number; removed: number }>()
  let totalTurns = 0
  let erroredTurns = 0
  let lastTurnErrored = false
  const reactionSamples: Array<{
    readonly prompt_index: number
    readonly prompt_text: string
    readonly previous_turn_errored: boolean
  }> = []

  for (const record of records) {
    if (record.type === "start") {
      start = record
      continue
    }
    if (record.type === "prompt") {
      const promptIndex = prompts.length
      prompts.push({
        prompt_index: promptIndex,
        time: record.time,
        text: record.text,
        files: record.files,
      })
      if (promptIndex > 0) {
        reactionSamples.push({
          prompt_index: promptIndex,
          prompt_text: record.text.slice(0, 240),
          previous_turn_errored: lastTurnErrored,
        })
      }
      continue
    }
    if (record.type === "turn") {
      totalTurns += 1
      if (record.errored) erroredTurns += 1
      lastTurnErrored = record.errored
      for (const file of record.files_changed) {
        const existing = filesChangedMap.get(file.path)
        if (existing) {
          existing.added += file.lines_added
          existing.removed += file.lines_removed
        } else {
          filesChangedMap.set(file.path, { added: file.lines_added, removed: file.lines_removed })
        }
      }
      const currentPrompt = prompts[prompts.length - 1]
      if (currentPrompt && !currentPrompt.turn) {
        currentPrompt.turn = summarizeTurn(record)
      }
      continue
    }
    if (record.type === "teach_qa") {
      teachQA.push({
        question: record.question,
        answer: record.answer,
        time: record.time,
      })
    }
  }

  const filesChanged: FileChangeSummary[] = [...filesChangedMap.entries()].map(([filePath, counts]) => ({
    path: filePath,
    lines_added: counts.added,
    lines_removed: counts.removed,
  }))

  const sessionModel =
    model ?? (start && (start.provider || start.model) ? `${start.provider}/${start.model}`.replace(/^\/|\/$/g, "") : "")

  return {
    prompts,
    overview: {
      project_name: projectTitle ?? start?.project_name ?? "",
      session_model: sessionModel,
      teach_mode: start?.teach_mode ?? teachQA.length > 0,
      total_prompts: prompts.length,
      total_turns: totalTurns,
      errored_turns: erroredTurns,
      files_changed: filesChanged,
      teach_qa: teachQA,
      reaction_samples: reactionSamples.slice(0, 15),
    },
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function dedupeModelSpecs(specs: readonly GraderModelSpec[]): GraderModelSpec[] {
  const seen = new Set<string>()
  const unique: GraderModelSpec[] = []
  for (const spec of specs) {
    const key = `${spec.provider}/${spec.model}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(spec)
  }
  return unique
}

export async function gradeSession(
  record: GradeSessionRecordInput,
  tier: GraderTier,
  options: GradeSessionOptions = {},
): Promise<SessionGradeResult> {
  const { prompts, overview } = extractSessionItems(record)
  if (prompts.length === 0) {
    throw new GraderError("EMPTY_SESSION", "Session record contains no prompts to grade.")
  }

  const batchSize = options.batchSize ?? GRADING_BATCH_SIZE
  const batches = chunk(prompts, batchSize)
  const tierConfig = getGraderTierConfig(tier, options.env)
  const modelFactory = options.modelFactory ?? createDefaultModelFactory(options.env)
  const system = loadGradeInstructions()

  const mergedPrompts: PromptGradeWithModel[] = []
  const modelsUsed: GraderModelSpec[] = []
  let understanding: UnderstandingScore | undefined
  let notes: SessionNotes | undefined
  let finalModelUsed: GraderModelSpec | undefined

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx += 1) {
    const batchItems = batches[batchIdx]!
    const isFinalBatch = batchIdx === batches.length - 1
    const expectedIndices = batchItems.map((item) => item.prompt_index)
    const schema = createBatchResponseSchema(expectedIndices, isFinalBatch)
    const userPrompt = buildBatchPrompt({
      batchNumber: batchIdx + 1,
      totalBatches: batches.length,
      prompts: batchItems,
      includeSessionSummary: isFinalBatch,
      overview: isFinalBatch ? overview : undefined,
    })

    const { output, modelUsed } = await runStructuredWithFallback({
      tierConfig,
      modelFactory,
      system,
      prompt: userPrompt,
      schema,
      timeoutMs: options.timeoutMs,
    })

    modelsUsed.push(modelUsed)
    finalModelUsed = modelUsed

    for (const grade of output.prompts) {
      mergedPrompts.push({
        ...grade,
        model_used: modelUsed,
      })
    }

    if (isFinalBatch) {
      understanding = output.understanding
      notes = output.notes
    }
  }

  mergedPrompts.sort((a, b) => a.prompt_index - b.prompt_index)

  if (!understanding || !notes || !finalModelUsed) {
    throw new GraderError("INCOMPLETE_RESULT", "Grader did not return session understanding and notes.")
  }

  return {
    tier,
    prompts: mergedPrompts,
    understanding,
    notes,
    model_used: finalModelUsed,
    models_used: dedupeModelSpecs(modelsUsed),
    batch_count: batches.length,
  }
}

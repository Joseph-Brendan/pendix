import {
  PromptReasonsSchema,
  PromptScoresSchema,
  SessionNotesSchema,
  UnderstandingScoreSchema,
  type PromptGrade,
  type SessionNotes,
  type UnderstandingScore,
} from "@pendix/shared/rubric"
import { z } from "zod"

export const IndexedPromptGradeSchema = z
  .object({
    prompt_index: z.number().int().min(0),
    scores: PromptScoresSchema,
    reasons: PromptReasonsSchema,
    total: z.number().int().min(0).max(10),
    improved_prompt: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    const sum =
      data.scores.goal +
      data.scores.context +
      data.scores.constraints +
      data.scores.verification +
      data.scores.steps
    if (data.total !== sum) {
      ctx.addIssue({
        code: "custom",
        path: ["total"],
        message: `Total (${data.total}) must equal sum of criterion scores (${sum})`,
      })
    }
  })

export type IndexedPromptGrade = z.infer<typeof IndexedPromptGradeSchema> & PromptGrade

export interface BatchGradeOutput {
  readonly prompts: IndexedPromptGrade[]
  readonly understanding?: UnderstandingScore
  readonly notes?: SessionNotes
}

export function createBatchResponseSchema(
  expectedIndices: readonly number[],
  includeSessionSummary: boolean,
): z.ZodType<BatchGradeOutput> {
  const baseFields = {
    prompts: z.array(IndexedPromptGradeSchema).min(expectedIndices.length).max(expectedIndices.length),
  }

  const schema = includeSessionSummary
    ? z.object({
        ...baseFields,
        understanding: UnderstandingScoreSchema,
        notes: SessionNotesSchema,
      })
    : z.object(baseFields)

  return schema.superRefine((data, ctx) => {
    const expectedSet = new Set(expectedIndices)
    const seen = new Set<number>()

    for (let i = 0; i < data.prompts.length; i += 1) {
      const idx = data.prompts[i]!.prompt_index
      if (!expectedSet.has(idx)) {
        ctx.addIssue({
          code: "custom",
          path: ["prompts", i, "prompt_index"],
          message: `Unexpected prompt_index ${idx}; expected one of [${expectedIndices.join(", ")}]`,
        })
      }
      if (seen.has(idx)) {
        ctx.addIssue({
          code: "custom",
          path: ["prompts", i, "prompt_index"],
          message: `Duplicate prompt_index ${idx}`,
        })
      }
      seen.add(idx)
    }

    for (const idx of expectedIndices) {
      if (!seen.has(idx)) {
        ctx.addIssue({
          code: "custom",
          path: ["prompts"],
          message: `Missing grade for prompt_index ${idx}`,
        })
      }
    }
  })
}

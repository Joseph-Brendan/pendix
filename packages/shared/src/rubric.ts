import { z } from "zod"

export const RUBRIC_CRITERIA = ["goal", "context", "constraints", "verification", "steps"] as const
export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number]

export interface RubricCriterionDefinition {
  readonly key: RubricCriterion
  readonly label: string
  readonly levels: Readonly<{
    0: string
    1: string
    2: string
  }>
}

export const RUBRIC: Readonly<Record<RubricCriterion, RubricCriterionDefinition>> = {
  goal: {
    key: "goal",
    label: "Goal",
    levels: {
      0: "no clear outcome",
      1: "outcome stated but vague",
      2: "clear specific outcome",
    },
  },
  context: {
    key: "context",
    label: "Context",
    levels: {
      0: "none",
      1: "some with gaps",
      2: "the files, stack and current state the agent needs",
    },
  },
  constraints: {
    key: "constraints",
    label: "Constraints",
    levels: {
      0: "none",
      1: "some limits",
      2: "clear limits (what not to touch, versions, style)",
    },
  },
  verification: {
    key: "verification",
    label: "Verification",
    levels: {
      0: "no way to check",
      1: "vague check",
      2: "concrete test or observable result",
    },
  },
  steps: {
    key: "steps",
    label: "Steps",
    levels: {
      0: "one giant ask",
      1: "partly broken down",
      2: "sensible order or scoped to one step",
    },
  },
} as const

export const GRADING_BATCH_SIZE = 15
export const SESSION_NOTES_MAX_WORDS = 250
export const GOLDEN_EXACT_MATCH_MIN = 0.8
export const GOLDEN_OFF_BY_TWO_MAX = 0.05

export const CriterionScoreSchema = z.number().int().min(0).max(2)

export const PromptScoresSchema = z.object({
  goal: CriterionScoreSchema,
  context: CriterionScoreSchema,
  constraints: CriterionScoreSchema,
  verification: CriterionScoreSchema,
  steps: CriterionScoreSchema,
})

export const PromptReasonsSchema = z.object({
  goal: z.string().trim().min(1),
  context: z.string().trim().min(1),
  constraints: z.string().trim().min(1),
  verification: z.string().trim().min(1),
  steps: z.string().trim().min(1),
})

export const PromptGradeSchema = z
  .object({
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

export const UnderstandingScoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string().trim().min(1),
})

export type PromptScores = z.infer<typeof PromptScoresSchema>
export type PromptReasons = z.infer<typeof PromptReasonsSchema>
export type PromptGrade = z.infer<typeof PromptGradeSchema>
export type UnderstandingScore = z.infer<typeof UnderstandingScoreSchema>

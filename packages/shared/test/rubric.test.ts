import { describe, expect, it } from "vitest"
import { PromptGradeSchema, RUBRIC, RUBRIC_CRITERIA, UnderstandingScoreSchema } from "../src/rubric.js"

const validGrade = {
  scores: {
    goal: 2,
    context: 2,
    constraints: 1,
    verification: 2,
    steps: 1,
  },
  reasons: {
    goal: "States the exact endpoint and response shape.",
    context: "Names the framework, files and database.",
    constraints: "Sets one rule but leaves error format open.",
    verification: "Lists concrete tests to run.",
    steps: "Covers two pieces in one prompt.",
  },
  total: 8,
  improved_prompt: "Split the endpoint and tests into step 1, and specify the 400 error shape.",
  confidence: 0.92,
}

describe("rubric", () => {
  it("defines the five S7 criteria with level 0, 1 and 2 descriptions", () => {
    expect(RUBRIC_CRITERIA).toEqual(["goal", "context", "constraints", "verification", "steps"])
    for (const criterion of RUBRIC_CRITERIA) {
      expect(RUBRIC[criterion].levels[0].length).toBeGreaterThan(0)
      expect(RUBRIC[criterion].levels[1].length).toBeGreaterThan(0)
      expect(RUBRIC[criterion].levels[2].length).toBeGreaterThan(0)
    }
  })

  it("accepts a valid prompt grade", () => {
    const result = PromptGradeSchema.safeParse(validGrade)
    expect(result.success).toBe(true)
  })

  it("rejects a criterion score of 3", () => {
    const result = PromptGradeSchema.safeParse({
      ...validGrade,
      scores: { ...validGrade.scores, goal: 3 },
      total: 9,
    })
    expect(result.success).toBe(false)
  })

  it("rejects a total that does not match the sum of criterion scores", () => {
    const result = PromptGradeSchema.safeParse({
      ...validGrade,
      total: 9,
    })
    expect(result.success).toBe(false)
  })

  it("rejects a missing improved_prompt", () => {
    const { improved_prompt: _omitted, ...withoutImproved } = validGrade
    expect(PromptGradeSchema.safeParse(withoutImproved).success).toBe(false)
    expect(PromptGradeSchema.safeParse({ ...validGrade, improved_prompt: "" }).success).toBe(false)
  })

  it("validates understanding scores from 0 to 10 with a reason", () => {
    expect(UnderstandingScoreSchema.safeParse({ score: 7, reason: "Explained session expiry clearly." }).success).toBe(
      true,
    )
    expect(UnderstandingScoreSchema.safeParse({ score: 11, reason: "Too high." }).success).toBe(false)
    expect(UnderstandingScoreSchema.safeParse({ score: -1, reason: "Negative." }).success).toBe(false)
    expect(UnderstandingScoreSchema.safeParse({ score: 7, reason: "" }).success).toBe(false)
  })
})

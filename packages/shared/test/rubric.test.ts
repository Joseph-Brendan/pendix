import { describe, expect, it } from "vitest"
import {
  PromptGradeSchema,
  RUBRIC,
  RUBRIC_CRITERIA,
  SessionNotesSchema,
  UnderstandingScoreSchema,
  countWords,
} from "../src/rubric.js"

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

  it("validates session notes under 250 words with 3 things learned and 2 things to work on", () => {
    const validNotes = {
      what_was_built: "Added server-side signup validation with Zod and unit tests.",
      things_learned: [
        "Validate request payloads on the server as well as the browser.",
        "Return 400 responses with clear error fields.",
        "Write focused tests for invalid inputs.",
      ],
      things_to_work_on: [
        "Name the exact file path in your first prompt.",
        "State a concrete command to check each change.",
      ],
      summary:
        "You added server-side signup validation with Zod and unit tests. You learned to validate on the server, return clear 400 responses, and test invalid inputs. Next, name exact file paths early and include a concrete test command.",
    }
    expect(SessionNotesSchema.safeParse(validNotes).success).toBe(true)
    expect(countWords(validNotes.summary)).toBeLessThan(250)

    const tooLong = {
      ...validNotes,
      summary: Array.from({ length: 250 }, (_, i) => `word${i}`).join(" "),
    }
    expect(SessionNotesSchema.safeParse(tooLong).success).toBe(false)
  })
})

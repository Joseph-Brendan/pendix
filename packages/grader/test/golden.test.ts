import { describe, expect, it } from "vitest"
import {
  evaluateGoldenAgreement,
  filterEvaluationPrompts,
  formatGoldenReportMarkdown,
  type GoldenPromptItem,
  type ModelPromptJudgment,
} from "../src/golden.js"

const TINY_GOLDEN: readonly GoldenPromptItem[] = [
  {
    id: "g_work",
    prompt: "worked example prompt",
    context_note: "Worked example context",
    scores: { goal: 2, context: 2, constraints: 2, verification: 2, steps: 2 },
    total: 10,
    reason: "Worked example should be excluded.",
    worked_example: true,
    mentor_test: false,
  },
  {
    id: "g_1",
    prompt: "prompt one",
    context_note: "ctx 1",
    scores: { goal: 2, context: 1, constraints: 0, verification: 1, steps: 2 },
    total: 6,
    reason: "Human reason 1.",
    worked_example: false,
    mentor_test: true,
  },
  {
    id: "g_2",
    prompt: "prompt two",
    context_note: "ctx 2",
    scores: { goal: 0, context: 0, constraints: 0, verification: 0, steps: 0 },
    total: 0,
    reason: "Human reason 2.",
    worked_example: false,
    mentor_test: false,
  },
  {
    id: "g_3",
    prompt: "prompt three",
    context_note: "ctx 3",
    scores: { goal: 2, context: 2, constraints: 2, verification: 2, steps: 2 },
    total: 10,
    reason: "Human reason 3.",
    worked_example: false,
    mentor_test: false,
  },
  {
    id: "g_4",
    prompt: "prompt four",
    context_note: "ctx 4",
    scores: { goal: 1, context: 1, constraints: 1, verification: 1, steps: 1 },
    total: 5,
    reason: "Human reason 4.",
    worked_example: false,
    mentor_test: false,
  },
  {
    id: "g_5",
    prompt: "prompt five",
    context_note: "ctx 5",
    scores: { goal: 2, context: 2, constraints: 1, verification: 2, steps: 1 },
    total: 8,
    reason: "Human reason 5.",
    worked_example: false,
    mentor_test: false,
  },
]

describe("golden agreement maths", () => {
  it("skips worked_example prompts and keeps the rest", () => {
    const filtered = filterEvaluationPrompts(TINY_GOLDEN)
    expect(filtered.map((item) => item.id)).toEqual(["g_1", "g_2", "g_3", "g_4", "g_5"])
  })

  it("computes exact, off-by-one, and off-by-two rates per criterion and overall and passes at 80%+ exact and <=5% off-by-two", () => {
    const evalItems = filterEvaluationPrompts(TINY_GOLDEN)
    // 5 items: 4 exact + 1 off-by-1 on goal => 80% exact, 20% off-by-1, 0% off-by-2 => PASS.
    const judgments: ModelPromptJudgment[] = evalItems.map((item, idx) => ({
      id: item.id,
      scores:
        idx === 0
          ? { ...item.scores, goal: 1 } // off by 1 on goal
          : { ...item.scores },
      reasons: {
        goal: "Model goal reason",
        context: "Model context reason",
        constraints: "Model constraints reason",
        verification: "Model verification reason",
        steps: "Model steps reason",
      },
      total: idx === 0 ? item.total - 1 : item.total,
    }))

    const report = evaluateGoldenAgreement(evalItems, judgments)
    expect(report.passed).toBe(true)
    expect(report.promptCount).toBe(5)
    expect(report.perCriterion.goal).toEqual({
      total: 5,
      exact: 4,
      offByOne: 1,
      offByTwo: 0,
      exactRate: 0.8,
      offByOneRate: 0.2,
      offByTwoRate: 0,
      passed: true,
    })
    expect(report.perCriterion.context.exactRate).toBe(1)
    expect(report.overall).toEqual({
      total: 25,
      exact: 24,
      offByOne: 1,
      offByTwo: 0,
      exactRate: 24 / 25,
      offByOneRate: 1 / 25,
      offByTwoRate: 0,
      passed: true,
    })
    expect(report.worstDisagreements).toHaveLength(1)
    expect(report.worstDisagreements[0]!.id).toBe("g_1")
  })

  it("fails when any criterion falls below 80% exact or exceeds 5% off-by-two and ranks worst disagreements", () => {
    const evalItems = filterEvaluationPrompts(TINY_GOLDEN)
    // On g_2 (all 0s), model predicts goal=2 (off-by-2 => 20% > 5%) and context=2 (off-by-2).
    // On g_3 (all 2s), model predicts steps=1 (off-by-1).
    const judgments: ModelPromptJudgment[] = evalItems.map((item) => {
      if (item.id === "g_2") {
        return {
          id: item.id,
          scores: { goal: 2, context: 2, constraints: 0, verification: 0, steps: 0 },
          reasons: {
            goal: "Thought it was clear",
            context: "Assumed implicit context",
            constraints: "None",
            verification: "None",
            steps: "None",
          },
          total: 4,
        }
      }
      if (item.id === "g_3") {
        return {
          id: item.id,
          scores: { goal: 2, context: 2, constraints: 2, verification: 2, steps: 1 },
          reasons: {
            goal: "Clear",
            context: "Clear",
            constraints: "Clear",
            verification: "Clear",
            steps: "Partly broken down",
          },
          total: 9,
        }
      }
      return {
        id: item.id,
        scores: { ...item.scores },
        reasons: {
          goal: "Match",
          context: "Match",
          constraints: "Match",
          verification: "Match",
          steps: "Match",
        },
        total: item.total,
      }
    })

    const report = evaluateGoldenAgreement(evalItems, judgments)
    expect(report.passed).toBe(false)
    expect(report.perCriterion.goal.offByTwo).toBe(1)
    expect(report.perCriterion.goal.offByTwoRate).toBe(0.2)
    expect(report.perCriterion.goal.passed).toBe(false)
    expect(report.perCriterion.steps.passed).toBe(true)

    // g_2 has 2 off-by-two diffs (total error 4), so it ranks #1 ahead of g_3 (error 1).
    expect(report.worstDisagreements.map((d) => d.id)).toEqual(["g_2", "g_3"])
    expect(report.worstDisagreements[0]!.humanReason).toBe("Human reason 2.")
    expect(report.worstDisagreements[0]!.modelReason).toContain("Thought it was clear")

    const markdown = formatGoldenReportMarkdown({
      date: "2026-11-26",
      tier: "credit",
      modelsUsed: [{ provider: "deepseek", model: "deepseek-flash" }],
      report,
    })
    expect(markdown).toContain("FAIL")
    expect(markdown).toContain("g_2")
    expect(markdown).toContain("Human reason 2.")
    expect(markdown).toContain("Thought it was clear")
    expect(markdown).not.toContain("\u2014")
    expect(markdown).not.toContain("\u2013")
  })
})

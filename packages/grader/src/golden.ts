import {
  getGraderTierConfig,
  type GraderModelSpec,
  type GraderTier,
} from "@pendix/shared/models"
import {
  GOLDEN_EXACT_MATCH_MIN,
  GOLDEN_OFF_BY_TWO_MAX,
  GRADING_BATCH_SIZE,
  RUBRIC_CRITERIA,
  type PromptReasons,
  type PromptScores,
  type RubricCriterion,
} from "@pendix/shared/rubric"
import {
  createDefaultModelFactory,
  runStructuredWithFallback,
  type GraderModelFactory,
} from "./models.js"
import { loadGradeInstructions } from "./prompt.js"
import { createBatchResponseSchema } from "./schemas.js"

export interface GoldenPromptItem {
  readonly id: string
  readonly prompt: string
  readonly context_note: string
  readonly scores: PromptScores
  readonly total: number
  readonly reason: string
  readonly worked_example: boolean
  readonly mentor_test: boolean
}

export interface ModelPromptJudgment {
  readonly id: string
  readonly scores: PromptScores
  readonly reasons: PromptReasons
  readonly total: number
  readonly model_used?: GraderModelSpec
}

export interface CriterionAgreementStats {
  readonly total: number
  readonly exact: number
  readonly offByOne: number
  readonly offByTwo: number
  readonly exactRate: number
  readonly offByOneRate: number
  readonly offByTwoRate: number
  readonly passed: boolean
}

export interface CriterionDiffDetail {
  readonly criterion: RubricCriterion
  readonly human: number
  readonly model: number
  readonly diff: number
  readonly modelReason: string
}

export interface GoldenDisagreement {
  readonly id: string
  readonly prompt: string
  readonly contextNote: string
  readonly humanScores: PromptScores
  readonly modelScores: PromptScores
  readonly humanTotal: number
  readonly modelTotal: number
  readonly humanReason: string
  readonly modelReason: string
  readonly offByTwoCount: number
  readonly totalAbsError: number
  readonly diffs: readonly CriterionDiffDetail[]
}

export interface GoldenAgreementReport {
  readonly promptCount: number
  readonly perCriterion: Readonly<Record<RubricCriterion, CriterionAgreementStats>>
  readonly overall: CriterionAgreementStats
  readonly passed: boolean
  readonly worstDisagreements: readonly GoldenDisagreement[]
}

export function filterEvaluationPrompts(items: readonly GoldenPromptItem[]): GoldenPromptItem[] {
  return items.filter((item) => !item.worked_example)
}

function buildStats(total: number, exact: number, offByOne: number, offByTwo: number): CriterionAgreementStats {
  const exactRate = total === 0 ? 0 : exact / total
  const offByOneRate = total === 0 ? 0 : offByOne / total
  const offByTwoRate = total === 0 ? 0 : offByTwo / total
  return {
    total,
    exact,
    offByOne,
    offByTwo,
    exactRate,
    offByOneRate,
    offByTwoRate,
    passed: exactRate >= GOLDEN_EXACT_MATCH_MIN && offByTwoRate <= GOLDEN_OFF_BY_TWO_MAX,
  }
}

export function evaluateGoldenAgreement(
  humanItems: readonly GoldenPromptItem[],
  judgments: readonly ModelPromptJudgment[],
  maxDisagreements = 10,
): GoldenAgreementReport {
  const judgmentById = new Map<string, ModelPromptJudgment>()
  for (const j of judgments) {
    judgmentById.set(j.id, j)
  }

  const counters: Record<RubricCriterion, { total: number; exact: number; offByOne: number; offByTwo: number }> = {
    goal: { total: 0, exact: 0, offByOne: 0, offByTwo: 0 },
    context: { total: 0, exact: 0, offByOne: 0, offByTwo: 0 },
    constraints: { total: 0, exact: 0, offByOne: 0, offByTwo: 0 },
    verification: { total: 0, exact: 0, offByOne: 0, offByTwo: 0 },
    steps: { total: 0, exact: 0, offByOne: 0, offByTwo: 0 },
  }

  let overallTotal = 0
  let overallExact = 0
  let overallOffByOne = 0
  let overallOffByTwo = 0

  const disagreements: GoldenDisagreement[] = []

  for (const item of humanItems) {
    const model = judgmentById.get(item.id)
    if (!model) {
      throw new Error(`Missing model judgment for golden prompt ${item.id}`)
    }

    const diffs: CriterionDiffDetail[] = []
    let offByTwoCount = 0
    let totalAbsError = 0

    for (const criterion of RUBRIC_CRITERIA) {
      const humanScore = item.scores[criterion]
      const modelScore = model.scores[criterion]
      const diff = Math.abs(modelScore - humanScore)

      counters[criterion].total += 1
      overallTotal += 1

      if (diff === 0) {
        counters[criterion].exact += 1
        overallExact += 1
      } else if (diff === 1) {
        counters[criterion].offByOne += 1
        overallOffByOne += 1
        totalAbsError += 1
        diffs.push({
          criterion,
          human: humanScore,
          model: modelScore,
          diff,
          modelReason: model.reasons[criterion],
        })
      } else {
        counters[criterion].offByTwo += 1
        overallOffByTwo += 1
        offByTwoCount += 1
        totalAbsError += diff
        diffs.push({
          criterion,
          human: humanScore,
          model: modelScore,
          diff,
          modelReason: model.reasons[criterion],
        })
      }
    }

    if (diffs.length > 0) {
      const modelReasonSummary = diffs
        .map((d) => `${d.criterion} (${d.model} vs ${d.human}): ${d.modelReason}`)
        .join(" | ")
      disagreements.push({
        id: item.id,
        prompt: item.prompt,
        contextNote: item.context_note,
        humanScores: item.scores,
        modelScores: model.scores,
        humanTotal: item.total,
        modelTotal: model.total,
        humanReason: item.reason,
        modelReason: modelReasonSummary,
        offByTwoCount,
        totalAbsError,
        diffs,
      })
    }
  }

  const perCriterion = {
    goal: buildStats(counters.goal.total, counters.goal.exact, counters.goal.offByOne, counters.goal.offByTwo),
    context: buildStats(
      counters.context.total,
      counters.context.exact,
      counters.context.offByOne,
      counters.context.offByTwo,
    ),
    constraints: buildStats(
      counters.constraints.total,
      counters.constraints.exact,
      counters.constraints.offByOne,
      counters.constraints.offByTwo,
    ),
    verification: buildStats(
      counters.verification.total,
      counters.verification.exact,
      counters.verification.offByOne,
      counters.verification.offByTwo,
    ),
    steps: buildStats(counters.steps.total, counters.steps.exact, counters.steps.offByOne, counters.steps.offByTwo),
  } as const

  const overall = buildStats(overallTotal, overallExact, overallOffByOne, overallOffByTwo)
  const passed = RUBRIC_CRITERIA.every((criterion) => perCriterion[criterion].passed)

  disagreements.sort((a, b) => {
    if (b.offByTwoCount !== a.offByTwoCount) return b.offByTwoCount - a.offByTwoCount
    if (b.totalAbsError !== a.totalAbsError) return b.totalAbsError - a.totalAbsError
    const totalDiffB = Math.abs(b.modelTotal - b.humanTotal)
    const totalDiffA = Math.abs(a.modelTotal - a.humanTotal)
    if (totalDiffB !== totalDiffA) return totalDiffB - totalDiffA
    return a.id.localeCompare(b.id)
  })

  return {
    promptCount: humanItems.length,
    perCriterion,
    overall,
    passed,
    worstDisagreements: disagreements.slice(0, maxDisagreements),
  }
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

function formatScoreMap(scores: PromptScores): string {
  return `G:${scores.goal} Ctx:${scores.context} Con:${scores.constraints} V:${scores.verification} S:${scores.steps}`
}

export function formatGoldenReportMarkdown(input: {
  readonly date: string
  readonly tier: GraderTier
  readonly modelsUsed: readonly GraderModelSpec[]
  readonly report: GoldenAgreementReport
}): string {
  const status = input.report.passed ? "PASS" : "FAIL"
  const modelsText = input.modelsUsed.map((m) => `${m.provider}/${m.model}`).join(", ")
  const lines: string[] = [
    `# Golden Agreement Report: ${input.tier} (${input.date})`,
    "",
    `- Status: **${status}**`,
    `- Tier: \`${input.tier}\``,
    `- Models used: ${modelsText || "unknown"}`,
    `- Prompts evaluated: ${input.report.promptCount} (worked examples skipped)`,
    `- Pass rule: every criterion >= ${pct(GOLDEN_EXACT_MATCH_MIN)} exact and <= ${pct(GOLDEN_OFF_BY_TWO_MAX)} off by two`,
    "",
    "## Results by Criterion",
    "",
    "| Criterion | Exact | Off by 1 | Off by 2 | Pass |",
    "| --- | --- | --- | --- | --- |",
  ]

  for (const criterion of RUBRIC_CRITERIA) {
    const s = input.report.perCriterion[criterion]
    lines.push(
      `| ${criterion} | ${s.exact}/${s.total} (${pct(s.exactRate)}) | ${s.offByOne}/${s.total} (${pct(s.offByOneRate)}) | ${s.offByTwo}/${s.total} (${pct(s.offByTwoRate)}) | ${s.passed ? "PASS" : "FAIL"} |`,
    )
  }

  const o = input.report.overall
  lines.push(
    `| **overall** | **${o.exact}/${o.total} (${pct(o.exactRate)})** | **${o.offByOne}/${o.total} (${pct(o.offByOneRate)})** | **${o.offByTwo}/${o.total} (${pct(o.offByTwoRate)})** | **${status}** |`,
  )

  if (input.report.worstDisagreements.length > 0) {
    lines.push(
      "",
      `## Top ${input.report.worstDisagreements.length} Worst Disagreements`,
      "",
      "| ID | Human vs Model Scores | Human Reason | Model Reason |",
      "| --- | --- | --- | --- |",
    )
    for (const item of input.report.worstDisagreements) {
      const scoreCell = `Human ${item.humanTotal} (${formatScoreMap(item.humanScores)}) vs Model ${item.modelTotal} (${formatScoreMap(item.modelScores)})`
      lines.push(
        `| ${item.id} | ${escapeCell(scoreCell)} | ${escapeCell(item.humanReason)} | ${escapeCell(item.modelReason)} |`,
      )
    }
  }

  return `${lines.join("\n")}\n`
}

export interface GradeGoldenPromptsOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
  readonly timeoutMs?: number
  readonly batchSize?: number
}

export interface GradeGoldenPromptsResult {
  readonly tier: GraderTier
  readonly judgments: readonly ModelPromptJudgment[]
  readonly modelsUsed: readonly GraderModelSpec[]
  readonly report: GoldenAgreementReport
}

export async function gradeGoldenPrompts(
  items: readonly GoldenPromptItem[],
  tier: GraderTier,
  options: GradeGoldenPromptsOptions = {},
): Promise<GradeGoldenPromptsResult> {
  const evalItems = filterEvaluationPrompts(items)
  const batchSize = options.batchSize ?? GRADING_BATCH_SIZE
  const tierConfig = getGraderTierConfig(tier, options.env)
  const modelFactory = options.modelFactory ?? createDefaultModelFactory(options.env)
  const system = loadGradeInstructions()

  const judgments: ModelPromptJudgment[] = []
  const modelsSeen = new Map<string, GraderModelSpec>()

  const totalBatches = Math.ceil(evalItems.length / batchSize)
  for (let start = 0, batchNumber = 1; start < evalItems.length; start += batchSize, batchNumber += 1) {
    const slice = evalItems.slice(start, start + batchSize)
    const expectedIndices = slice.map((_, offset) => start + offset)
    const schema = createBatchResponseSchema(expectedIndices, false)

    const payload = {
      batch_number: batchNumber,
      total_batches: totalBatches,
      mode: "independent_prompts",
      prompt_indices: expectedIndices,
      prompts: slice.map((item, offset) => ({
        prompt_index: start + offset,
        text: item.prompt,
        context_note: item.context_note,
      })),
    }

    const userPrompt = [
      `Grade batch ${batchNumber} of ${totalBatches}.`,
      "Each prompt below is an independent standalone prompt from a different learner project. Use its context_note as background context.",
      `Return structured JSON grading every prompt_index in [${expectedIndices.join(", ")}].`,
      "",
      "Golden batch data (JSON):",
      JSON.stringify(payload, null, 2),
    ].join("\n")

    const { output, modelUsed } = await runStructuredWithFallback({
      tierConfig,
      modelFactory,
      system,
      prompt: userPrompt,
      schema,
      timeoutMs: options.timeoutMs,
    })

    modelsSeen.set(`${modelUsed.provider}/${modelUsed.model}`, modelUsed)

    for (const grade of output.prompts) {
      const targetItem = evalItems[grade.prompt_index]
      if (!targetItem) continue
      judgments.push({
        id: targetItem.id,
        scores: grade.scores,
        reasons: grade.reasons,
        total: grade.total,
        model_used: modelUsed,
      })
    }
  }

  const report = evaluateGoldenAgreement(evalItems, judgments)
  return {
    tier,
    judgments,
    modelsUsed: [...modelsSeen.values()],
    report,
  }
}

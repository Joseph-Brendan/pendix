import { gradeSession, type GraderModelFactory, type PromptGradeWithModel } from "@pendix/grader"
import type { RecorderRecord } from "@pendix/recorder"
import type { GraderTier } from "@pendix/shared/models"
import { RUBRIC_CRITERIA } from "@pendix/shared/rubric"
import { eq } from "drizzle-orm"
import type { Logger } from "pino"
import { markSessionGradingFailed } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { renderSessionReportEmail, type WeakestPromptSummary } from "../emails/session-report.js"
import type { Mailer } from "../mailer.js"
import { claimNextJob } from "./queue.js"

export const GRADE_SESSION_JOB_KIND = "grade_session"
export const MAX_GRADE_ATTEMPTS = 3

export function defaultGradeBackoffMs(attempt: number): number {
  return 30_000 * 2 ** Math.max(0, attempt - 1)
}

export interface GradeWorkerDeps {
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly webUrl: string
  readonly now?: () => number
  readonly logger?: Logger
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
  readonly timeoutMs?: number
  readonly backoffMs?: (attempt: number) => number
}

export type GradeJobOutcome =
  | {
      readonly status: "completed"
      readonly jobId: string
      readonly sessionId: string
      readonly emailed: boolean
      readonly averageScore: number
      readonly understandingScore: number
    }
  | {
      readonly status: "retrying"
      readonly jobId: string
      readonly sessionId: string
      readonly attempts: number
      readonly error: string
    }
  | {
      readonly status: "failed"
      readonly jobId: string
      readonly sessionId: string
      readonly attempts: number
      readonly refunded: boolean
      readonly error: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeTier(value: unknown): GraderTier {
  return value === "subscriber" ? "subscriber" : "credit"
}

function extractRecordsFromStoredJson(raw: unknown): readonly RecorderRecord[] {
  if (Array.isArray(raw)) return raw as readonly RecorderRecord[]
  if (isRecord(raw) && Array.isArray(raw.records)) {
    return raw.records as readonly RecorderRecord[]
  }
  return []
}

function summarizeWeakestReason(grade: PromptGradeWithModel): string {
  const lowestReasons: string[] = []
  const sortedCriteria = [...RUBRIC_CRITERIA].sort((a, b) => grade.scores[a] - grade.scores[b])
  for (const criterion of sortedCriteria.slice(0, 2)) {
    if (grade.scores[criterion] < 2) {
      lowestReasons.push(grade.reasons[criterion])
    }
  }
  if (lowestReasons.length === 0) {
    return grade.reasons.goal
  }
  return lowestReasons.join(" ")
}

function selectWeakestPrompts(
  grades: readonly PromptGradeWithModel[],
  promptTexts: readonly string[],
): WeakestPromptSummary[] {
  const ranked = [...grades].sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total
    return a.prompt_index - b.prompt_index
  })

  return ranked.slice(0, 2).map((grade) => ({
    promptIndex: grade.prompt_index,
    original: promptTexts[grade.prompt_index] ?? `Prompt #${grade.prompt_index + 1}`,
    score: grade.total,
    improved: grade.improved_prompt,
    why: summarizeWeakestReason(grade),
  }))
}

function formatModelUsed(spec: { readonly provider: string; readonly model: string }): string {
  return `${spec.provider}/${spec.model}`
}

export async function processNextGradeJob(deps: GradeWorkerDeps): Promise<GradeJobOutcome | null> {
  const nowFn = deps.now ?? (() => Date.now())
  const backoffFn = deps.backoffMs ?? defaultGradeBackoffMs
  const claimed = await claimNextJob(deps.db, GRADE_SESSION_JOB_KIND, new Date(nowFn()))
  if (!claimed) return null

  const payload = isRecord(claimed.payload) ? claimed.payload : {}
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : ""
  if (!sessionId) {
    const finishNow = new Date(nowFn())
    await deps.db
      .update(schema.jobs)
      .set({ status: "failed", last_error: "Missing session_id in job payload", updated_at: finishNow })
      .where(eq(schema.jobs.id, claimed.id))
    return {
      status: "failed",
      jobId: claimed.id,
      sessionId: "",
      attempts: claimed.attempts,
      refunded: false,
      error: "Missing session_id in job payload",
    }
  }

  try {
    const [sessionRow] = await deps.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
    if (!sessionRow) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const [recordRow] = await deps.db
      .select()
      .from(schema.sessionRecords)
      .where(eq(schema.sessionRecords.session_id, sessionId))
    if (!recordRow) {
      throw new Error(`Session record for ${sessionId} not found`)
    }

    const [userRow] = await deps.db.select().from(schema.users).where(eq(schema.users.id, sessionRow.user_id))
    if (!userRow) {
      throw new Error(`User ${sessionRow.user_id} not found`)
    }

    await deps.db.update(schema.sessions).set({ status: "grading" }).where(eq(schema.sessions.id, sessionId))

    const records = extractRecordsFromStoredJson(recordRow.redacted_json)
    const tier = normalizeTier(payload.tier ?? sessionRow.tier)
    const gradeResult = await gradeSession(
      {
        records,
        project_title: sessionRow.project_title,
        model: sessionRow.model,
      },
      tier,
      {
        env: deps.env,
        modelFactory: deps.modelFactory,
        timeoutMs: deps.timeoutMs,
      },
    )

    const completedAt = new Date(nowFn())
    const sessionModelLabel = formatModelUsed(gradeResult.model_used)

    await deps.db.transaction(async (tx) => {
      await tx.delete(schema.grades).where(eq(schema.grades.session_id, sessionId))
      await tx.delete(schema.sessionNotes).where(eq(schema.sessionNotes.session_id, sessionId))
      await tx.delete(schema.understandingScores).where(eq(schema.understandingScores.session_id, sessionId))

      if (gradeResult.prompts.length > 0) {
        await tx.insert(schema.grades).values(
          gradeResult.prompts.map((promptGrade) => ({
            session_id: sessionId,
            prompt_index: promptGrade.prompt_index,
            scores: promptGrade.scores,
            reasons: promptGrade.reasons,
            total: promptGrade.total,
            improved_prompt: promptGrade.improved_prompt,
            confidence: promptGrade.confidence,
            model_used: formatModelUsed(promptGrade.model_used),
            created_at: completedAt,
          })),
        )
      }

      await tx.insert(schema.sessionNotes).values({
        session_id: sessionId,
        what_was_built: gradeResult.notes.what_was_built,
        learned: gradeResult.notes.things_learned,
        to_work_on: gradeResult.notes.things_to_work_on,
        summary: gradeResult.notes.summary,
        model_used: sessionModelLabel,
        created_at: completedAt,
      })

      await tx.insert(schema.understandingScores).values({
        session_id: sessionId,
        score: gradeResult.understanding.score,
        reason: gradeResult.understanding.reason,
        model_used: sessionModelLabel,
        created_at: completedAt,
      })

      await tx
        .update(schema.sessions)
        .set({ status: "graded", graded_at: completedAt })
        .where(eq(schema.sessions.id, sessionId))

      await tx
        .update(schema.jobs)
        .set({ status: "completed", last_error: null, updated_at: completedAt })
        .where(eq(schema.jobs.id, claimed.id))
    })

    const totalSum = gradeResult.prompts.reduce((sum, item) => sum + item.total, 0)
    const averageScore =
      gradeResult.prompts.length > 0 ? Math.round((totalSum / gradeResult.prompts.length) * 10) / 10 : 0

    let emailed = false
    if (userRow.session_report_emails) {
      const promptTexts = records.filter((r) => r.type === "prompt").map((r) => r.text)
      const weakestPrompts = selectWeakestPrompts(gradeResult.prompts, promptTexts)
      const reportUrl = `${deps.webUrl.replace(/\/$/, "")}/sessions/${sessionId}`
      const email = await renderSessionReportEmail({
        to: userRow.email,
        displayName: userRow.display_name,
        sessionTitle: sessionRow.project_title || "Coding session",
        sessionDate: sessionRow.created_at.toISOString().slice(0, 10),
        promptScore: averageScore,
        understandingScore: gradeResult.understanding.score,
        understandingReason: gradeResult.understanding.reason,
        weakestPrompts,
        notes: gradeResult.notes,
        reportUrl,
      })

      try {
        await deps.mailer.send(email)
        await deps.db
          .update(schema.sessions)
          .set({ report_emailed_at: new Date(nowFn()) })
          .where(eq(schema.sessions.id, sessionId))
        emailed = true
      } catch (emailError) {
        deps.logger?.error({ sessionId, err: emailError }, "failed to email session report; grades remain stored")
      }
    }

    return {
      status: "completed",
      jobId: claimed.id,
      sessionId,
      emailed,
      averageScore,
      understandingScore: gradeResult.understanding.score,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const failedAtMs = nowFn()
    const failedAt = new Date(failedAtMs)

    if (claimed.attempts < MAX_GRADE_ATTEMPTS) {
      const nextRunAt = new Date(failedAtMs + backoffFn(claimed.attempts))
      await deps.db.transaction(async (tx) => {
        await tx
          .update(schema.jobs)
          .set({
            status: "pending",
            run_at: nextRunAt,
            last_error: errorMessage,
            updated_at: failedAt,
          })
          .where(eq(schema.jobs.id, claimed.id))

        await tx.update(schema.sessions).set({ status: "queued" }).where(eq(schema.sessions.id, sessionId))
      })

      deps.logger?.warn(
        { jobId: claimed.id, sessionId, attempts: claimed.attempts, nextRunAt: nextRunAt.toISOString() },
        "grading attempt failed; scheduled retry",
      )

      return {
        status: "retrying",
        jobId: claimed.id,
        sessionId,
        attempts: claimed.attempts,
        error: errorMessage,
      }
    }

    await deps.db
      .update(schema.jobs)
      .set({
        status: "failed",
        last_error: errorMessage,
        updated_at: failedAt,
      })
      .where(eq(schema.jobs.id, claimed.id))

    const refundResult = await markSessionGradingFailed(deps.db, sessionId, failedAt)
    deps.logger?.error(
      { jobId: claimed.id, sessionId, attempts: claimed.attempts, refunded: refundResult.refunded },
      "grading permanently failed; session marked failed and credit refunded if charged",
    )

    return {
      status: "failed",
      jobId: claimed.id,
      sessionId,
      attempts: claimed.attempts,
      refunded: refundResult.refunded,
      error: errorMessage,
    }
  }
}

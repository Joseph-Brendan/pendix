import { buildAssessment, type GraderModelFactory, type WeekSessionInput } from "@pendix/grader"
import type { RecorderRecord } from "@pendix/recorder"
import type { GraderTier } from "@pendix/shared/models"
import { and, eq, gte, lte } from "drizzle-orm"
import type { Logger } from "pino"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { renderWeeklyAssessmentEmail } from "../emails/weekly-assessment.js"
import { getEntitlements } from "../entitlements.js"
import type { Mailer } from "../mailer.js"

const DAY_MS = 24 * 60 * 60 * 1000
export const WEEKLY_ASSESSMENT_MIN_SESSIONS = 2
export const WEEKLY_ASSESSMENT_DUE_DAYS = 7
export const WEEKLY_ASSESSMENT_TARGET_HOUR = 9

export interface LocalClockParts {
  readonly weekday: string
  readonly dateKey: string
  readonly hour: number
  readonly minute: number
}

export function getLocalClockInTimeZone(date: Date, timeZone: string): LocalClockParts {
  const tz = timeZone.trim() || "UTC"
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
  }

  const parts = formatter.formatToParts(date)
  const valueOf = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  const weekday = valueOf("weekday")
  const year = valueOf("year")
  const month = valueOf("month")
  const day = valueOf("day")
  const rawHour = Number(valueOf("hour"))
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0
  const rawMinute = Number(valueOf("minute"))
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0

  return {
    weekday,
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
  }
}

/**
 * Returns whether `date` is at or past Saturday 09:00 in the user's time zone,
 * along with the local Saturday date key (YYYY-MM-DD) used for weekly deduplication.
 */
export function isWeeklyAssessmentWindow(
  date: Date,
  timeZone: string,
): { readonly eligible: boolean; readonly weekKey: string } {
  const local = getLocalClockInTimeZone(date, timeZone)
  return {
    eligible: local.weekday === "Sat" && local.hour >= WEEKLY_ASSESSMENT_TARGET_HOUR,
    weekKey: local.dateKey,
  }
}

function extractRecords(raw: unknown): readonly RecorderRecord[] {
  if (Array.isArray(raw)) return raw as readonly RecorderRecord[]
  if (typeof raw === "object" && raw !== null && Array.isArray((raw as { records?: unknown }).records)) {
    return (raw as { records: readonly RecorderRecord[] }).records
  }
  return []
}

export interface WeeklyAssessmentSchedulerOptions {
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly webUrl: string
  readonly now?: () => Date
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
  readonly timeoutMs?: number
  readonly logger?: Logger
}

export interface WeeklyAssessmentSchedulerResult {
  readonly createdCount: number
  readonly createdUserIds: readonly string[]
}

export async function runWeeklyAssessmentScheduler(
  options: WeeklyAssessmentSchedulerOptions,
): Promise<WeeklyAssessmentSchedulerResult> {
  const now = (options.now ?? (() => new Date()))()
  const weekStart = new Date(now.getTime() - 7 * DAY_MS)
  const dueAt = new Date(now.getTime() + WEEKLY_ASSESSMENT_DUE_DAYS * DAY_MS)

  const activeUsers = await options.db.select().from(schema.users).where(eq(schema.users.status, "active"))

  const createdUserIds: string[] = []

  for (const user of activeUsers) {
    const window = isWeeklyAssessmentWindow(now, user.tz)
    if (!window.eligible) continue

    const [existing] = await options.db
      .select({ id: schema.assessments.id })
      .from(schema.assessments)
      .where(and(eq(schema.assessments.user_id, user.id), eq(schema.assessments.week_key, window.weekKey)))

    if (existing) continue

    const ent = await getEntitlements(options.db, user.id, now)
    if (!ent.can_assess) continue

    const weekSessions = await options.db
      .select({
        session_id: schema.sessions.id,
        project_title: schema.sessions.project_title,
        redacted_json: schema.sessionRecords.redacted_json,
      })
      .from(schema.sessions)
      .innerJoin(schema.sessionRecords, eq(schema.sessionRecords.session_id, schema.sessions.id))
      .where(
        and(
          eq(schema.sessions.user_id, user.id),
          eq(schema.sessions.status, "graded"),
          gte(schema.sessions.graded_at, weekStart),
          lte(schema.sessions.graded_at, now),
        ),
      )

    if (weekSessions.length < WEEKLY_ASSESSMENT_MIN_SESSIONS) continue

    const weekInputs: WeekSessionInput[] = weekSessions.map((row) => ({
      session_id: row.session_id,
      project_title: row.project_title,
      records: extractRecords(row.redacted_json),
    }))

    const tier: GraderTier = ent.plan === "free" ? "credit" : "subscriber"

    let built: Awaited<ReturnType<typeof buildAssessment>>
    try {
      built = await buildAssessment(weekInputs, tier, {
        env: options.env,
        modelFactory: options.modelFactory,
        timeoutMs: options.timeoutMs,
      })
    } catch (error) {
      options.logger?.error({ userId: user.id, err: error }, "failed to build weekly assessment")
      continue
    }

    const modelLabel = `${built.model_used.provider}/${built.model_used.model}`

    // Note: Subscribers are never charged. Credit users are NOT charged on creation;
    // they are charged 2 credits only when they confirm opening the assessment.
    let assessmentId: string | null = null
    try {
      assessmentId = await options.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.assessments)
          .values({
            user_id: user.id,
            week_key: window.weekKey,
            tier,
            model_used: modelLabel,
            status: "available",
            due_at: dueAt,
            created_at: now,
          })
          .returning()

        await tx.insert(schema.assessmentAnswers).values(
          built.questions.map((q) => ({
            assessment_id: created!.id,
            question_index: q.question_index,
            question_kind: q.question_kind,
            reference_target: q.reference_target,
            prompt: q.prompt,
            choices: q.choices ?? null,
            reference_answer: q.reference_answer,
            created_at: now,
          })),
        )

        return created!.id
      })
    } catch (error) {
      options.logger?.warn({ userId: user.id, weekKey: window.weekKey, err: error }, "weekly assessment insert skipped")
      continue
    }

    if (!assessmentId) continue

    const assessmentUrl = `${options.webUrl.replace(/\/$/, "")}/assessments/${assessmentId}`
    const email = await renderWeeklyAssessmentEmail({
      to: user.email,
      displayName: user.display_name,
      dueDate: dueAt.toISOString().slice(0, 10),
      assessmentUrl,
      isCreditUser: ent.plan === "free",
    })

    try {
      await options.mailer.send(email)
    } catch (emailError) {
      options.logger?.error({ userId: user.id, assessmentId, err: emailError }, "failed to email weekly check notice")
    }

    createdUserIds.push(user.id)
  }

  return {
    createdCount: createdUserIds.length,
    createdUserIds,
  }
}

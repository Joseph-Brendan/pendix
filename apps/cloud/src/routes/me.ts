import { entitlementsFor } from "@pendix/shared/plans"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { getCreditHistory } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { getEntitlements } from "../entitlements.js"
import { AppError } from "../errors.js"
import { requireAuth, type AuthVariables } from "../middleware/auth.js"

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

const DeleteMeSchema = z.object({
  confirm: z.literal(true),
})

const PreferencesSchema = z.object({
  session_report_emails: z.boolean(),
})

const UpdateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  tz: z.string().trim().min(1).max(64).optional(),
  session_report_emails: z.boolean().optional(),
  teach_lock: z.enum(["none", "self"]).optional(),
  grading_consent: z.boolean().optional(),
})

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
})

export interface MeRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly now: () => number
}

export function createMeRoutes(deps: MeRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)

  router.get("/me", authMiddleware, async (c) => {
    const user = c.get("user")!
    const ent = await getEntitlements(deps.db, user.id, new Date(deps.now()))

    return c.json({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      account_kind: user.account_kind,
      status: user.status,
      plan: ent.plan,
      credits: ent.credit_balance,
      entitlements: entitlementsFor(ent.plan),
      teach_lock: ent.teach_lock,
    })
  })

  router.get("/me/profile", authMiddleware, async (c) => {
    const user = c.get("user")!
    const nowDate = new Date(deps.now())
    const [ent, [userRow], [gradingConsent]] = await Promise.all([
      getEntitlements(deps.db, user.id, nowDate),
      deps.db
        .select({
          tz: schema.users.tz,
          session_report_emails: schema.users.session_report_emails,
        })
        .from(schema.users)
        .where(eq(schema.users.id, user.id)),
      deps.db
        .select({ id: schema.consents.id })
        .from(schema.consents)
        .where(
          and(
            eq(schema.consents.user_id, user.id),
            eq(schema.consents.kind, "grading"),
            isNull(schema.consents.revoked_at),
          ),
        ),
    ])

    return c.json({
      display_name: user.display_name,
      email: user.email,
      tz: userRow?.tz ?? "UTC",
      session_report_emails: userRow?.session_report_emails ?? true,
      grading_consent: Boolean(gradingConsent),
      teach_lock: ent.teach_lock,
      period_end: ent.period_end,
      fair_use_remaining: ent.fair_use_remaining,
      graded_sessions_this_month: ent.graded_sessions_this_month,
      has_mentor: ent.has_mentor,
    })
  })

  router.get("/me/dashboard", authMiddleware, async (c) => {
    const user = c.get("user")!
    const nowMs = deps.now()
    const eightWeeksAgo = new Date(nowMs - 8 * WEEK_MS)

    const [recentSessions, trendSessions, openAssessments, activeMatches] = await Promise.all([
      deps.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.user_id, user.id))
        .orderBy(desc(schema.sessions.created_at))
        .limit(5),
      deps.db
        .select({
          id: schema.sessions.id,
          graded_at: schema.sessions.graded_at,
          created_at: schema.sessions.created_at,
        })
        .from(schema.sessions)
        .where(and(eq(schema.sessions.user_id, user.id), eq(schema.sessions.status, "graded")))
        .orderBy(desc(schema.sessions.created_at)),
      deps.db
        .select()
        .from(schema.assessments)
        .where(and(eq(schema.assessments.user_id, user.id), inArray(schema.assessments.status, ["available", "opened"])))
        .orderBy(desc(schema.assessments.created_at))
        .limit(1),
      deps.db
        .select({
          matched_at: schema.matches.matched_at,
          mentor_name: schema.users.display_name,
          mentor_tz: schema.users.tz,
        })
        .from(schema.matches)
        .innerJoin(schema.users, eq(schema.matches.mentor_user_id, schema.users.id))
        .where(and(eq(schema.matches.learner_user_id, user.id), eq(schema.matches.status, "active")))
        .limit(1),
    ])

    const allIds = [...new Set([...recentSessions.map((s) => s.id), ...trendSessions.map((s) => s.id)])]
    const scoreBySession = new Map<string, number>()
    const understandingBySession = new Map<string, number>()

    if (allIds.length > 0) {
      const [gradeAvgs, understandingRows] = await Promise.all([
        deps.db
          .select({
            session_id: schema.grades.session_id,
            avg_total: sql<number>`round(avg(${schema.grades.total})::numeric, 1)::float8`,
          })
          .from(schema.grades)
          .where(inArray(schema.grades.session_id, allIds))
          .groupBy(schema.grades.session_id),
        deps.db
          .select({
            session_id: schema.understandingScores.session_id,
            score: schema.understandingScores.score,
          })
          .from(schema.understandingScores)
          .where(inArray(schema.understandingScores.session_id, allIds)),
      ])
      for (const row of gradeAvgs) scoreBySession.set(row.session_id, row.avg_total)
      for (const row of understandingRows) understandingBySession.set(row.session_id, row.score)
    }

    // Build 8 weekly buckets (oldest to newest, ending at nowMs).
    const trend: Array<{
      readonly week_start: string
      readonly prompt_score: number | null
      readonly understanding_score: number | null
      readonly sessions: number
    }> = []

    for (let i = 7; i >= 0; i -= 1) {
      const bucketEnd = nowMs - i * WEEK_MS
      const bucketStart = bucketEnd - WEEK_MS
      const inBucket = trendSessions.filter((s) => {
        const ts = (s.graded_at ?? s.created_at).getTime()
        return ts > bucketStart && ts <= bucketEnd && ts >= eightWeeksAgo.getTime()
      })
      const pScores = inBucket.map((s) => scoreBySession.get(s.id)).filter((v): v is number => typeof v === "number")
      const uScores = inBucket
        .map((s) => understandingBySession.get(s.id))
        .filter((v): v is number => typeof v === "number")

      trend.push({
        week_start: new Date(bucketStart + DAY_MS).toISOString().slice(0, 10),
        prompt_score: pScores.length > 0 ? Math.round((pScores.reduce((a, b) => a + b, 0) / pScores.length) * 10) / 10 : null,
        understanding_score:
          uScores.length > 0 ? Math.round((uScores.reduce((a, b) => a + b, 0) / uScores.length) * 10) / 10 : null,
        sessions: inBucket.length,
      })
    }

    const currentWeek = trend[trend.length - 1]!
    const dueRow = openAssessments[0]
    const mentorRow = activeMatches[0]

    return c.json({
      this_week: {
        prompt_score: currentWeek.prompt_score,
        understanding_score: currentWeek.understanding_score,
        graded_sessions: currentWeek.sessions,
      },
      trend,
      recent_sessions: recentSessions.map((row) => ({
        id: row.id,
        project_title: row.project_title,
        model: row.model,
        status: row.status,
        created_at: row.created_at.toISOString(),
        graded_at: row.graded_at ? row.graded_at.toISOString() : null,
        score: scoreBySession.get(row.id) ?? null,
        understanding_score: understandingBySession.get(row.id) ?? null,
      })),
      assessment_due: dueRow
        ? {
            id: dueRow.id,
            status: dueRow.status,
            due_at: dueRow.due_at.toISOString(),
            week_key: dueRow.week_key,
          }
        : null,
      mentor: mentorRow
        ? {
            display_name: mentorRow.mentor_name,
            tz: mentorRow.mentor_tz,
            matched_at: mentorRow.matched_at.toISOString(),
          }
        : null,
    })
  })

  router.get("/me/credits", authMiddleware, async (c) => {
    const user = c.get("user")!
    const history = await getCreditHistory(deps.db, user.id, 50)
    return c.json(history)
  })

  router.patch("/me/preferences", authMiddleware, async (c) => {
    const user = c.get("user")!
    const body = PreferencesSchema.parse(await c.req.json())

    await deps.db
      .update(schema.users)
      .set({
        session_report_emails: body.session_report_emails,
        updated_at: new Date(deps.now()),
      })
      .where(eq(schema.users.id, user.id))

    return c.json({
      session_report_emails: body.session_report_emails,
    })
  })

  router.patch("/me/profile", authMiddleware, async (c) => {
    const user = c.get("user")!
    const body = UpdateProfileSchema.parse(await c.req.json())
    const nowDate = new Date(deps.now())

    if (body.teach_lock !== undefined) {
      const currentEnt = await getEntitlements(deps.db, user.id, nowDate)
      if (currentEnt.teach_lock === "class") {
        throw new AppError(403, "CLASS_TEACH_LOCKED", "Teach mode is locked on by your instructor.")
      }
    }

    const updates: Partial<typeof schema.users.$inferInsert> = {
      updated_at: nowDate,
    }
    if (body.display_name !== undefined) updates.display_name = body.display_name
    if (body.tz !== undefined) updates.tz = body.tz
    if (body.session_report_emails !== undefined) updates.session_report_emails = body.session_report_emails
    if (body.teach_lock !== undefined) updates.teach_lock = body.teach_lock

    await deps.db.update(schema.users).set(updates).where(eq(schema.users.id, user.id))

    if (body.grading_consent === true) {
      const [existingConsent] = await deps.db
        .select({ id: schema.consents.id })
        .from(schema.consents)
        .where(
          and(
            eq(schema.consents.user_id, user.id),
            eq(schema.consents.kind, "grading"),
            isNull(schema.consents.revoked_at),
          ),
        )
      if (!existingConsent) {
        await deps.db.insert(schema.consents).values({
          user_id: user.id,
          kind: "grading",
          version: "2026-01",
          granted_at: nowDate,
        })
      }
    } else if (body.grading_consent === false) {
      await deps.db
        .update(schema.consents)
        .set({ revoked_at: nowDate })
        .where(
          and(
            eq(schema.consents.user_id, user.id),
            eq(schema.consents.kind, "grading"),
            isNull(schema.consents.revoked_at),
          ),
        )
    }

    const ent = await getEntitlements(deps.db, user.id, nowDate)
    return c.json({
      ok: true,
      display_name: body.display_name ?? user.display_name,
      tz: body.tz,
      session_report_emails: body.session_report_emails,
      teach_lock: ent.teach_lock,
    })
  })

  router.post("/me/password", authMiddleware, async (c) => {
    const body = ChangePasswordSchema.parse(await c.req.json())
    const response = await deps.auth.api.changePassword({
      body: {
        currentPassword: body.current_password,
        newPassword: body.new_password,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    })

    if (!response.ok) {
      const errData = (await response.json().catch(() => ({}))) as { message?: string }
      throw new AppError(400, "PASSWORD_CHANGE_FAILED", errData.message ?? "Could not change password.")
    }

    return c.json({ ok: true })
  })

  router.delete("/me", authMiddleware, async (c) => {
    const user = c.get("user")!
    DeleteMeSchema.parse(await c.req.json())

    await deps.db.delete(schema.authVerifications).where(eq(schema.authVerifications.identifier, user.email))
    await deps.db.delete(schema.users).where(eq(schema.users.id, user.id))

    return c.json({ ok: true, deleted: true })
  })

  return router
}

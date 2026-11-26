import { MAX_RECORD_BYTES, redactSession, redactText, type RecorderRecord } from "@pendix/recorder"
import { CREDIT_COSTS } from "@pendix/shared/plans"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { insertCreditEntry } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { getEntitlements } from "../entitlements.js"
import { AppError } from "../errors.js"
import { GRADE_SESSION_JOB_KIND } from "../jobs/grade-worker.js"
import { enqueueJob } from "../jobs/queue.js"
import { requireActiveAccount, requireAuth, type AuthVariables } from "../middleware/auth.js"

const GradingConsentSchema = z.object({
  granted: z.literal(true),
  version: z.string().trim().min(1).max(32).default("2026-01"),
})

const FileChangeSchema = z.object({
  path: z.string(),
  lines_added: z.number().int().min(0),
  lines_removed: z.number().int().min(0),
})

const StartRecordSchema = z.object({
  type: z.literal("start"),
  session_id: z.string().min(1),
  time: z.string().min(1),
  project_name: z.string(),
  provider: z.string(),
  model: z.string(),
  teach_mode: z.boolean(),
})

const PromptRecordSchema = z.object({
  type: z.literal("prompt"),
  session_id: z.string().min(1),
  time: z.string().min(1),
  text: z.string(),
  files: z.array(z.string()),
})

const TurnRecordSchema = z.object({
  type: z.literal("turn"),
  session_id: z.string().min(1),
  time: z.string().min(1),
  tools: z.record(z.string(), z.number().int().min(0)),
  files_changed: z.array(FileChangeSchema),
  commands: z.array(z.string()),
  errored: z.boolean(),
  reply_preview: z.string(),
})

const TeachQARecordSchema = z.object({
  type: z.literal("teach_qa"),
  session_id: z.string().min(1),
  time: z.string().min(1),
  question: z.string(),
  answer: z.string(),
})

const EndRecordSchema = z.object({
  type: z.literal("end"),
  session_id: z.string().min(1),
  time: z.string().min(1),
  reason: z.enum(["quit", "idle_30m", "new_session"]),
})

const RecorderRecordSchema = z.discriminatedUnion("type", [
  StartRecordSchema,
  PromptRecordSchema,
  TurnRecordSchema,
  TeachQARecordSchema,
  EndRecordSchema,
])

const UploadSessionSchema = z.object({
  source: z.enum(["terminal", "claude-code", "codex", "other"]).default("terminal"),
  local_session_id: z.string().trim().min(1).max(128).optional(),
  project_title: z.string().trim().max(200).optional(),
  model: z.string().trim().max(200).optional(),
  records: z.array(RecorderRecordSchema).min(1),
})

export interface SessionsRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly now: () => number
}

export function createSessionsRoutes(deps: SessionsRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)
  const activeMiddleware = requireActiveAccount()

  router.post("/consents/grading", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = GradingConsentSchema.parse(await c.req.json())

    const [created] = await deps.db
      .insert(schema.consents)
      .values({
        user_id: user.id,
        kind: "grading",
        version: body.version,
      })
      .returning()

    return c.json(
      {
        ok: true,
        kind: "grading",
        version: body.version,
        granted_at: created!.granted_at,
      },
      201,
    )
  })

  router.post("/sessions", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!

    // Check Content-Length upfront and enforce exact byte size limit (2 MB).
    const headerLen = Number(c.req.header("content-length") ?? "0")
    if (Number.isFinite(headerLen) && headerLen > MAX_RECORD_BYTES) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Session record exceeds the 2 MB limit.")
    }

    const rawText = await c.req.text()
    if (Buffer.byteLength(rawText, "utf8") > MAX_RECORD_BYTES) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Session record exceeds the 2 MB limit.")
    }

    let rawJson: unknown
    try {
      rawJson = JSON.parse(rawText)
    } catch {
      throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.")
    }

    const body = UploadSessionSchema.parse(rawJson)

    // SPEC S12: Upload only with grading consent and entitlement.
    const [gradingConsent] = await deps.db
      .select({ id: schema.consents.id })
      .from(schema.consents)
      .where(
        and(
          eq(schema.consents.user_id, user.id),
          eq(schema.consents.kind, "grading"),
          isNull(schema.consents.revoked_at),
        ),
      )

    if (!gradingConsent) {
      throw new AppError(403, "GRADING_CONSENT_REQUIRED", "Grading consent is required before uploading sessions.")
    }

    // Run redactor again on the server; store cleaned version and log count only if anything was caught.
    const { records: cleanedRecords, counts } = redactSession(body.records as readonly RecorderRecord[])
    const startRecord = cleanedRecords.find((r) => r.type === "start")
    const rawTitle = body.project_title ?? (startRecord?.type === "start" ? startRecord.project_name : "")
    const cleanedTitle = redactText(rawTitle, { includePii: true })
    const model = body.model ?? (startRecord?.type === "start" ? startRecord.model : "")

    const mergedCounts: Record<string, number> = {}
    let totalRedactions = 0
    for (const source of [counts, cleanedTitle.counts]) {
      for (const [kind, count] of Object.entries(source)) {
        if (typeof count === "number" && count > 0) {
          mergedCounts[kind] = (mergedCounts[kind] ?? 0) + count
          totalRedactions += count
        }
      }
    }

    if (totalRedactions > 0) {
      c.get("logger")?.warn(
        { redactionCount: totalRedactions, countsByKind: mergedCounts },
        "server-side redaction cleaned secrets missed by client",
      )
    }

    const nowDate = new Date(deps.now())

    // Charge credits or count against monthly fair use atomically under a per-user row lock.
    const { createdSession, tier, chargedCredit } = await deps.db.transaction(async (tx) => {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, user.id)).for("update")

      const ent = await getEntitlements(tx, user.id, nowDate)
      let resolvedTier: "subscriber" | "credit"
      let shouldChargeCredit = false

      if (ent.plan === "solo" || ent.plan === "mentored") {
        if (ent.fair_use_remaining > 0) {
          resolvedTier = "subscriber"
        } else if (ent.credit_balance >= CREDIT_COSTS.sessionGrade) {
          resolvedTier = "credit"
          shouldChargeCredit = true
        } else {
          throw new AppError(
            403,
            "FAIR_USE_REACHED",
            "Monthly fair use limit reached. Buy credits to grade more sessions this month.",
          )
        }
      } else if (ent.credit_balance >= CREDIT_COSTS.sessionGrade) {
        resolvedTier = "credit"
        shouldChargeCredit = true
      } else {
        throw new AppError(
          403,
          "NO_CREDITS",
          "Not enough credits. Buy credits or subscribe to grade this session.",
        )
      }

      const [sessionRow] = await tx
        .insert(schema.sessions)
        .values({
          user_id: user.id,
          source: body.source,
          project_title: cleanedTitle.text,
          model,
          status: "queued",
          tier: resolvedTier,
          created_at: nowDate,
        })
        .returning()

      await tx.insert(schema.sessionRecords).values({
        session_id: sessionRow!.id,
        redacted_json: {
          local_session_id: body.local_session_id ?? null,
          records: cleanedRecords,
        },
        created_at: nowDate,
      })

      if (shouldChargeCredit) {
        await insertCreditEntry(tx, {
          userId: user.id,
          amount: -CREDIT_COSTS.sessionGrade,
          reason: "session_grade",
          referenceId: sessionRow!.id,
          createdAt: nowDate,
        })
      }

      await enqueueJob(tx, {
        kind: GRADE_SESSION_JOB_KIND,
        payload: {
          session_id: sessionRow!.id,
          tier: resolvedTier,
        },
        runAt: nowDate,
        createdAt: nowDate,
      })

      return { createdSession: sessionRow!, tier: resolvedTier, chargedCredit: shouldChargeCredit }
    })

    return c.json(
      {
        id: createdSession.id,
        status: createdSession.status,
        tier,
        charged_credit: chargedCredit,
        redaction_count: totalRedactions,
      },
      201,
    )
  })

  router.get("/sessions", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const rows = await deps.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.user_id, user.id))
      .orderBy(desc(schema.sessions.created_at))

    if (rows.length === 0) {
      return c.json({ sessions: [] })
    }

    const sessionIds = rows.map((row) => row.id)
    const gradeAverages = await deps.db
      .select({
        session_id: schema.grades.session_id,
        avg_total: sql<number>`round(avg(${schema.grades.total})::numeric, 1)::float8`,
      })
      .from(schema.grades)
      .where(inArray(schema.grades.session_id, sessionIds))
      .groupBy(schema.grades.session_id)

    const understandingRows = await deps.db
      .select({
        session_id: schema.understandingScores.session_id,
        score: schema.understandingScores.score,
      })
      .from(schema.understandingScores)
      .where(inArray(schema.understandingScores.session_id, sessionIds))

    const scoreBySession = new Map(gradeAverages.map((row) => [row.session_id, row.avg_total]))
    const understandingBySession = new Map(understandingRows.map((row) => [row.session_id, row.score]))

    return c.json({
      sessions: rows.map((row) => ({
        ...row,
        score: scoreBySession.get(row.id) ?? null,
        understanding_score: understandingBySession.get(row.id) ?? null,
        report_emailed: row.report_emailed_at !== null,
      })),
    })
  })

  return router
}

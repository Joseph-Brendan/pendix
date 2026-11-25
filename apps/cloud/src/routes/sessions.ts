import { MAX_RECORD_BYTES, redactSession, redactText, type RecorderRecord } from "@pendix/recorder"
import { CREDIT_COSTS } from "@pendix/shared/plans"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
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

async function resolveUploadTier(
  db: CloudDatabase,
  userId: string,
): Promise<"subscriber" | "credit" | undefined> {
  const [activeSub] = await db
    .select({ plan: schema.subscriptions.plan })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.user_id, userId), eq(schema.subscriptions.status, "active")))

  if (activeSub && (activeSub.plan === "solo" || activeSub.plan === "mentored")) {
    return "subscriber"
  }

  const [groupSeat] = await db
    .select({ seat_plan: schema.groupMembers.seat_plan })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.user_id, userId))

  if (groupSeat && (groupSeat.seat_plan === "solo" || groupSeat.seat_plan === "mentored")) {
    return "subscriber"
  }

  const [creditRow] = await db
    .select({ balance: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int` })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.user_id, userId))

  if ((creditRow?.balance ?? 0) >= CREDIT_COSTS.sessionGrade) {
    return "credit"
  }

  return undefined
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

    const tier = await resolveUploadTier(deps.db, user.id)
    if (!tier) {
      throw new AppError(403, "ENTITLEMENT_REQUIRED", "Buy credits or subscribe to upload sessions for grading.")
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

    const [createdSession] = await deps.db
      .insert(schema.sessions)
      .values({
        user_id: user.id,
        source: body.source,
        project_title: cleanedTitle.text,
        model,
        status: "queued",
        tier,
      })
      .returning()

    await deps.db.insert(schema.sessionRecords).values({
      session_id: createdSession!.id,
      redacted_json: {
        local_session_id: body.local_session_id ?? null,
        records: cleanedRecords,
      },
    })

    return c.json(
      {
        id: createdSession!.id,
        status: createdSession!.status,
        tier,
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
      })),
    })
  })

  return router
}

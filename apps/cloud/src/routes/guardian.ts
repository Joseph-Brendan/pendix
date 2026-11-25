import crypto from "node:crypto"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import {
  GUARDIAN_LOGIN_TTL_MS,
  hashToken,
  signToken,
  verifySignedToken,
  type CloudAuth,
  type GuardianApprovalTokenPayload,
  type GuardianLoginTokenPayload,
} from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import { buildGuardianLoginEmail, type Mailer } from "../mailer.js"
import { resolveSessionUser, type AuthVariables } from "../middleware/auth.js"

const ABOUT_PENDIX =
  "Pendix is a coding assistant and learning tool. Learners build real software while getting feedback on their prompts and understanding. For teens aged 15 to 17, guardians approve the account, can read mentor messages, and handle any paid plans."

const CURRENT_GUARDIAN_CONSENT_VERSION = "2026-01"

const ApprovalDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    consent_version: z.string().trim().min(1).default(CURRENT_GUARDIAN_CONSENT_VERSION),
  }),
  z.object({
    decision: z.literal("decline"),
  }),
])

const GuardianLoginRequestSchema = z.object({
  email: z.string().trim().email(),
})

export interface GuardianRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly authSecret: string
  readonly webUrl: string
  readonly now: () => number
}

async function loadPendingApproval(token: string, deps: GuardianRoutesDeps) {
  const verified = verifySignedToken<GuardianApprovalTokenPayload>(token, "guardian_approval", deps.authSecret)
  if (verified.status === "invalid") {
    throw new AppError(400, "INVALID_APPROVAL_LINK", "This approval link is not valid.")
  }

  const nowMs = deps.now()
  if (nowMs > verified.payload.exp) {
    throw new AppError(410, "APPROVAL_LINK_EXPIRED", "This approval link has expired.")
  }

  const [guardian] = await deps.db
    .select()
    .from(schema.guardians)
    .where(eq(schema.guardians.id, verified.payload.guardianId))

  if (!guardian || guardian.teen_user_id !== verified.payload.teenUserId || guardian.approved_at !== null) {
    throw new AppError(410, "APPROVAL_LINK_EXPIRED", "This approval link is no longer active.")
  }

  if (!guardian.token_hash || guardian.token_hash !== hashToken(token)) {
    throw new AppError(400, "INVALID_APPROVAL_LINK", "This approval link is not valid.")
  }

  if (guardian.expires_at && nowMs > guardian.expires_at.getTime()) {
    throw new AppError(410, "APPROVAL_LINK_EXPIRED", "This approval link has expired.")
  }

  const [teen] = await deps.db.select().from(schema.users).where(eq(schema.users.id, guardian.teen_user_id))
  if (!teen) {
    throw new AppError(410, "APPROVAL_LINK_EXPIRED", "This approval link is no longer active.")
  }

  return { guardian, teen }
}

export function createGuardianRoutes(deps: GuardianRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()

  router.get("/guardian/approval/:token", async (c) => {
    const token = c.req.param("token")
    const { guardian, teen } = await loadPendingApproval(token, deps)

    return c.json({
      teen_display_name: teen.display_name,
      about_pendix: ABOUT_PENDIX,
      guardian_consent_version: CURRENT_GUARDIAN_CONSENT_VERSION,
      expires_at: guardian.expires_at?.toISOString() ?? null,
    })
  })

  router.post("/guardian/approval/:token", async (c) => {
    const token = c.req.param("token")
    const body = ApprovalDecisionSchema.parse(await c.req.json())
    const { guardian, teen } = await loadPendingApproval(token, deps)

    if (body.decision === "decline") {
      await deps.db.delete(schema.authVerifications).where(eq(schema.authVerifications.identifier, teen.email))
      await deps.db.delete(schema.users).where(eq(schema.users.id, teen.id))
      return c.json({ ok: true, decision: "declined" })
    }

    // Guardian may already be signed into a Pendix account, or approve via the emailed link.
    const signedIn = await resolveSessionUser(c, deps)
    let guardianUserId: string
    let loginLinkSent = false

    if (signedIn) {
      if (signedIn.id === teen.id) {
        throw new AppError(403, "INVALID_GUARDIAN", "A teen cannot approve their own account.")
      }
      if (signedIn.account_kind !== "adult") {
        throw new AppError(403, "INVALID_GUARDIAN", "A guardian must have an adult account.")
      }
      guardianUserId = signedIn.id
    } else {
      const [existingGuardian] = await deps.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, guardian.email.toLowerCase()))

      if (existingGuardian) {
        if (existingGuardian.account_kind !== "adult") {
          throw new AppError(403, "INVALID_GUARDIAN", "A guardian must have an adult account.")
        }
        guardianUserId = existingGuardian.id
      } else {
        const [createdGuardian] = await deps.db
          .insert(schema.users)
          .values({
            email: guardian.email.toLowerCase(),
            email_verified: true,
            display_name: guardian.email.split("@")[0] ?? "Guardian",
            dob: "",
            account_kind: "adult",
            status: "active",
            role: "guardian",
          })
          .returning()
        guardianUserId = createdGuardian!.id
      }

      const loginPayload: GuardianLoginTokenPayload = {
        kind: "guardian_login",
        userId: guardianUserId,
        email: guardian.email.toLowerCase(),
        exp: deps.now() + GUARDIAN_LOGIN_TTL_MS,
      }
      const loginToken = signToken(loginPayload, deps.authSecret)
      const loginUrl = `${deps.webUrl.replace(/\/$/, "")}/guardian/login?token=${loginToken}`
      await deps.mailer.send(buildGuardianLoginEmail({ to: guardian.email.toLowerCase(), loginUrl }))
      loginLinkSent = true
    }

    const approvedAt = new Date(deps.now())
    await deps.db.transaction(async (tx) => {
      await tx
        .update(schema.guardians)
        .set({
          guardian_user_id: guardianUserId,
          approved_at: approvedAt,
          token_hash: null,
        })
        .where(eq(schema.guardians.id, guardian.id))

      await tx
        .update(schema.users)
        .set({
          status: "active",
          updated_at: approvedAt,
        })
        .where(eq(schema.users.id, teen.id))

      await tx.insert(schema.consents).values({
        user_id: teen.id,
        kind: "guardian",
        version: body.consent_version,
        granted_at: approvedAt,
      })
    })

    return c.json({
      ok: true,
      decision: "approved",
      teen_user_id: teen.id,
      guardian_user_id: guardianUserId,
      login_link_sent: loginLinkSent,
    })
  })

  router.post("/guardian/login-link", async (c) => {
    const body = GuardianLoginRequestSchema.parse(await c.req.json())
    const normalized = body.email.toLowerCase()
    const [guardianUser] = await deps.db.select().from(schema.users).where(eq(schema.users.email, normalized))
    if (guardianUser && guardianUser.account_kind === "adult") {
      const payload: GuardianLoginTokenPayload = {
        kind: "guardian_login",
        userId: guardianUser.id,
        email: normalized,
        exp: deps.now() + GUARDIAN_LOGIN_TTL_MS,
      }
      const loginToken = signToken(payload, deps.authSecret)
      const loginUrl = `${deps.webUrl.replace(/\/$/, "")}/guardian/login?token=${loginToken}`
      await deps.mailer.send(buildGuardianLoginEmail({ to: normalized, loginUrl }))
    }
    return c.json({ ok: true })
  })

  router.get("/guardian/login-link/verify", async (c) => {
    const token = c.req.query("token") ?? ""
    const verified = verifySignedToken<GuardianLoginTokenPayload>(token, "guardian_login", deps.authSecret)
    if (verified.status === "invalid" || deps.now() > verified.payload.exp) {
      throw new AppError(400, "INVALID_LOGIN_LINK", "This sign-in link is invalid or expired.")
    }

    const sessionToken = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(deps.now() + 7 * 24 * 60 * 60 * 1000)
    await deps.db.insert(schema.authSessions).values({
      user_id: verified.payload.userId,
      token: sessionToken,
      expires_at: expiresAt,
    })

    return c.json({ ok: true, session_token: sessionToken, expires_at: expiresAt.toISOString() })
  })

  return router
}

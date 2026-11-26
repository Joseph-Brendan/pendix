import { accountKindFor } from "@pendix/shared/age"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import {
  GUARDIAN_APPROVAL_TTL_MS,
  hashToken,
  signToken,
  type CloudAuth,
  type GuardianApprovalTokenPayload,
} from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import { buildGuardianApprovalEmail, type Mailer } from "../mailer.js"
import { requireAuth, type AuthVariables } from "../middleware/auth.js"

const SignupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  display_name: z.string().trim().min(1).max(80),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD"),
  guardian_email: z.string().trim().email().optional(),
  terms_version: z.string().trim().min(1),
  privacy_version: z.string().trim().min(1),
  country: z.string().trim().max(8).optional(),
  tz: z.string().trim().max(64).optional(),
})

const SigninSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

const ForgotPasswordSchema = z.object({
  email: z.string().trim().email(),
})

const CompleteSignupSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD"),
  guardian_email: z.string().trim().email().optional(),
  terms_version: z.string().trim().min(1),
  privacy_version: z.string().trim().min(1),
  country: z.string().trim().max(8).optional(),
  tz: z.string().trim().max(64).optional(),
})

export interface AuthRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly authSecret: string
  readonly webUrl: string
  readonly now: () => number
}

function classifyAgeOrThrow(dob: string, nowMs: number) {
  try {
    return accountKindFor(dob, new Date(nowMs))
  } catch {
    throw new AppError(400, "INVALID_DOB", "Enter a valid date of birth.")
  }
}

async function createGuardianApproval(
  deps: AuthRoutesDeps,
  input: { readonly teenUserId: string; readonly teenDisplayName: string; readonly guardianEmail: string },
) {
  const expiresAt = new Date(deps.now() + GUARDIAN_APPROVAL_TTL_MS)
  const [guardian] = await deps.db
    .insert(schema.guardians)
    .values({
      email: input.guardianEmail.toLowerCase(),
      teen_user_id: input.teenUserId,
      expires_at: expiresAt,
    })
    .returning()

  const payload: GuardianApprovalTokenPayload = {
    kind: "guardian_approval",
    guardianId: guardian!.id,
    teenUserId: input.teenUserId,
    exp: expiresAt.getTime(),
  }
  const token = signToken(payload, deps.authSecret)
  await deps.db
    .update(schema.guardians)
    .set({ token_hash: hashToken(token) })
    .where(eq(schema.guardians.id, guardian!.id))

  const approvalUrl = `${deps.webUrl.replace(/\/$/, "")}/guardian/approval/${token}`
  await deps.mailer.send(
    buildGuardianApprovalEmail({
      to: input.guardianEmail.toLowerCase(),
      teenDisplayName: input.teenDisplayName,
      approvalUrl,
    }),
  )
}

export function createAuthRoutes(deps: AuthRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()

  router.post("/auth/signup", async (c) => {
    const body = SignupSchema.parse(await c.req.json())
    const normalizedEmail = body.email.toLowerCase()
    const kind = classifyAgeOrThrow(body.dob, deps.now())

    // S5/S6: under 15 is blocked and nothing is stored or emailed.
    if (kind === "blocked") {
      throw new AppError(
        403,
        "AGE_BLOCKED",
        "Pendix is for learners aged 15 and older. We have not saved your details.",
      )
    }

    if (kind === "teen") {
      const guardianEmail = body.guardian_email?.toLowerCase()
      if (!guardianEmail || guardianEmail === normalizedEmail) {
        throw new AppError(
          400,
          "INVALID_GUARDIAN_EMAIL",
          "A parent or guardian email different from your own is required.",
        )
      }
    }

    const initialStatus = kind === "teen" ? "pending_guardian" : "pending_verification"

    let created: { user: { id: string; email: string } }
    try {
      created = (await deps.auth.api.signUpEmail({
        body: {
          email: normalizedEmail,
          password: body.password,
          name: body.display_name,
          dob: body.dob,
          account_kind: kind,
          status: initialStatus,
          country: body.country ?? "",
          tz: body.tz ?? "UTC",
        },
      })) as { user: { id: string; email: string } }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create account"
      if (/already exists|unique/i.test(message)) {
        throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists.")
      }
      throw error
    }

    const userId = created.user.id
    await deps.db.insert(schema.consents).values([
      { user_id: userId, kind: "terms", version: body.terms_version },
      { user_id: userId, kind: "privacy", version: body.privacy_version },
    ])

    if (kind === "teen") {
      await createGuardianApproval(deps, {
        teenUserId: userId,
        teenDisplayName: body.display_name,
        guardianEmail: body.guardian_email!,
      })
    }

    return c.json(
      {
        user: {
          id: userId,
          email: normalizedEmail,
          display_name: body.display_name,
          account_kind: kind,
          status: initialStatus,
        },
      },
      201,
    )
  })

  router.post("/auth/signin", async (c) => {
    const body = SigninSchema.parse(await c.req.json())
    const response = await deps.auth.api.signInEmail({
      body: {
        email: body.email.toLowerCase(),
        password: body.password,
      },
      asResponse: true,
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string; code?: string }
      const status = response.status === 403 ? 403 : 401
      throw new AppError(status, data.code ?? "INVALID_CREDENTIALS", data.message ?? "Invalid email or password.")
    }

    return response
  })

  router.post("/auth/signout", async (c) => {
    const response = await deps.auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    })
    return response
  })

  router.post("/auth/forgot-password", async (c) => {
    const body = ForgotPasswordSchema.parse(await c.req.json())
    const redirectTo = `${deps.webUrl.replace(/\/$/, "")}/signin`
    await deps.auth.api
      .requestPasswordReset({
        body: {
          email: body.email.toLowerCase(),
          redirectTo,
        },
      })
      .catch(() => undefined)
    return c.json({
      ok: true,
      message: "If an account exists for that email, we sent a password reset link.",
    })
  })

  // Google sign-up completes date of birth, display name, and consents on the next screen.
  router.post("/auth/complete-signup", requireAuth(deps), async (c) => {
    const user = c.get("user")!
    const body = CompleteSignupSchema.parse(await c.req.json())
    const kind = classifyAgeOrThrow(body.dob, deps.now())

    if (kind === "blocked") {
      await deps.db.delete(schema.users).where(eq(schema.users.id, user.id))
      throw new AppError(
        403,
        "AGE_BLOCKED",
        "Pendix is for learners aged 15 and older. We have not saved your details.",
      )
    }

    if (kind === "teen") {
      const guardianEmail = body.guardian_email?.toLowerCase()
      if (!guardianEmail || guardianEmail === user.email.toLowerCase()) {
        throw new AppError(
          400,
          "INVALID_GUARDIAN_EMAIL",
          "A parent or guardian email different from your own is required.",
        )
      }
    }

    const nextStatus = kind === "teen" ? "pending_guardian" : user.email_verified ? "active" : "pending_verification"

    await deps.db
      .update(schema.users)
      .set({
        display_name: body.display_name,
        dob: body.dob,
        account_kind: kind,
        status: nextStatus,
        country: body.country ?? user.country,
        tz: body.tz ?? user.tz,
        updated_at: new Date(deps.now()),
      })
      .where(eq(schema.users.id, user.id))

    await deps.db.insert(schema.consents).values([
      { user_id: user.id, kind: "terms", version: body.terms_version },
      { user_id: user.id, kind: "privacy", version: body.privacy_version },
    ])

    if (kind === "teen") {
      await createGuardianApproval(deps, {
        teenUserId: user.id,
        teenDisplayName: body.display_name,
        guardianEmail: body.guardian_email!,
      })
    }

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        display_name: body.display_name,
        account_kind: kind,
        status: nextStatus,
      },
    })
  })

  // Mount Better Auth handler for email verification, Google OAuth, and session routes.
  router.all("/api/auth/*", (c) => deps.auth.handler(c.req.raw))

  return router
}

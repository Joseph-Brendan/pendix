import crypto from "node:crypto"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq } from "drizzle-orm"
import type { CloudDatabase } from "./db/index.js"
import { schema } from "./db/schema.js"
import { buildVerificationEmail, type Mailer } from "./mailer.js"

export const GUARDIAN_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const GUARDIAN_LOGIN_TTL_MS = 60 * 60 * 1000

export interface CreateAuthOptions {
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly secret: string
  readonly baseUrl: string
  readonly googleClientId?: string
  readonly googleClientSecret?: string
}

export function createAuth(options: CreateAuthOptions) {
  const googleEnabled = Boolean(options.googleClientId && options.googleClientSecret)

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    database: drizzleAdapter(options.db, {
      provider: "pg",
      camelCase: false,
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    user: {
      fields: {
        name: "display_name",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        dob: { type: "string", required: false, defaultValue: "" },
        account_kind: { type: "string", required: false, defaultValue: "pending" },
        status: { type: "string", required: false, defaultValue: "pending_onboarding" },
        country: { type: "string", required: false, defaultValue: "" },
        tz: { type: "string", required: false, defaultValue: "UTC" },
        role: { type: "string", required: false, defaultValue: "learner" },
      },
    },
    session: {
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url }) {
        await options.mailer.send(
          buildVerificationEmail({
            to: user.email,
            displayName: user.name,
            url,
          }),
        )
      },
      async afterEmailVerification(user) {
        const [existing] = await options.db.select().from(schema.users).where(eq(schema.users.id, user.id))
        if (!existing) return
        // Adults become active after email verification; teens stay pending_guardian until approved.
        if (existing.account_kind === "adult" && existing.status === "pending_verification") {
          await options.db
            .update(schema.users)
            .set({ status: "active", updated_at: new Date() })
            .where(eq(schema.users.id, user.id))
        }
      },
    },
    ...(googleEnabled
      ? {
          socialProviders: {
            google: {
              clientId: options.googleClientId!,
              clientSecret: options.googleClientSecret!,
            },
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const dob = typeof user.dob === "string" ? user.dob : ""
            if (!dob) {
              return {
                data: {
                  ...user,
                  dob: "",
                  account_kind: "pending",
                  status: "pending_onboarding",
                },
              }
            }
            return { data: user }
          },
        },
      },
    },
  })
}

export type CloudAuth = ReturnType<typeof createAuth>

export interface GuardianApprovalTokenPayload {
  readonly kind: "guardian_approval"
  readonly guardianId: string
  readonly teenUserId: string
  readonly exp: number
}

export interface GuardianLoginTokenPayload {
  readonly kind: "guardian_login"
  readonly userId: string
  readonly email: string
  readonly exp: number
}

type SignedPayload = GuardianApprovalTokenPayload | GuardianLoginTokenPayload

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export function signToken(payload: SignedPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url")
  return `${encoded}.${signature}`
}

export function verifySignedToken<T extends SignedPayload>(
  token: string,
  expectedKind: T["kind"],
  secret: string,
): { readonly status: "valid"; readonly payload: T } | { readonly status: "invalid" } {
  const parts = token.split(".")
  if (parts.length !== 2) return { status: "invalid" }
  const [encoded, signature] = parts
  if (!encoded || !signature) return { status: "invalid" }

  const expectedSig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url")
  const sigBuf = Buffer.from(signature, "utf8")
  const expectedBuf = Buffer.from(expectedSig, "utf8")
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { status: "invalid" }
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<T>
    if (parsed.kind !== expectedKind || typeof parsed.exp !== "number") {
      return { status: "invalid" }
    }
    return { status: "valid", payload: parsed as T }
  } catch {
    return { status: "invalid" }
  }
}

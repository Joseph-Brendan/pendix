import { and, eq, gt } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import type { CloudAuth } from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import type { RequestVariables } from "./request-id.js"

export type AuthenticatedUser = typeof schema.users.$inferSelect

export interface AuthVariables extends RequestVariables {
  user?: AuthenticatedUser
}

export async function resolveSessionUser(
  c: Context<{ Variables: AuthVariables }>,
  deps: { readonly auth: CloudAuth; readonly db: CloudDatabase; readonly now: () => number },
): Promise<AuthenticatedUser | undefined> {
  let userId: string | undefined

  const session = await deps.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
  if (session?.user?.id) {
    userId = session.user.id
  }

  if (!userId) {
    const authHeader = c.req.header("authorization")
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim()
      if (token) {
        const [row] = await deps.db
          .select()
          .from(schema.authSessions)
          .where(and(eq(schema.authSessions.token, token), gt(schema.authSessions.expires_at, new Date(deps.now()))))
        if (row) userId = row.user_id
      }
    }
  }

  if (!userId) return undefined
  const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.id, userId))
  return user
}

export function requireAuth(deps: {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly now: () => number
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = await resolveSessionUser(c, deps)
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Sign in required")
    }
    c.set("user", user)
    c.set("userId", user.id)
    await next()
  }
}

export function requireActiveAccount(): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get("user")
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Sign in required")
    }
    if (user.status === "pending_guardian") {
      throw new AppError(403, "GUARDIAN_PENDING", "A parent or guardian must approve your account first.")
    }
    if (user.status === "pending_onboarding") {
      throw new AppError(403, "ONBOARDING_REQUIRED", "Complete your date of birth to activate your account.")
    }
    if (user.status === "pending_verification") {
      throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address first.")
    }
    if (user.status === "paused") {
      throw new AppError(403, "ACCOUNT_PAUSED", "This account is paused.")
    }
    if (user.status === "closed") {
      throw new AppError(403, "ACCOUNT_CLOSED", "This account is closed.")
    }
    await next()
  }
}

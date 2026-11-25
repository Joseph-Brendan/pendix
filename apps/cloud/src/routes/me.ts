import { entitlementsFor, type PlanId } from "@pendix/shared/plans"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { requireActiveAccount, requireAuth, type AuthVariables } from "../middleware/auth.js"

const DeleteMeSchema = z.object({
  confirm: z.literal(true),
})

export interface MeRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly now: () => number
}

function normalizePlan(value: string | undefined): PlanId {
  if (value === "solo" || value === "mentored") return value
  return "free"
}

export function createMeRoutes(deps: MeRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)

  router.get("/me", authMiddleware, async (c) => {
    const user = c.get("user")!
    const [activeSub] = await deps.db
      .select()
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.user_id, user.id), eq(schema.subscriptions.status, "active")))

    const plan = normalizePlan(activeSub?.plan)

    return c.json({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      account_kind: user.account_kind,
      status: user.status,
      plan,
      entitlements: entitlementsFor(plan),
    })
  })

  router.delete("/me", authMiddleware, async (c) => {
    const user = c.get("user")!
    DeleteMeSchema.parse(await c.req.json())

    await deps.db.delete(schema.authVerifications).where(eq(schema.authVerifications.identifier, user.email))
    await deps.db.delete(schema.users).where(eq(schema.users.id, user.id))

    return c.json({ ok: true, deleted: true })
  })

  // Active-account protected route used by learner clients.
  router.get("/sessions", authMiddleware, requireActiveAccount(), async (c) => {
    const user = c.get("user")!
    const rows = await deps.db.select().from(schema.sessions).where(eq(schema.sessions.user_id, user.id))
    return c.json({ sessions: rows })
  })

  return router
}

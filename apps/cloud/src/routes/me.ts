import { entitlementsFor } from "@pendix/shared/plans"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { getCreditHistory } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { getEntitlements } from "../entitlements.js"
import { requireAuth, type AuthVariables } from "../middleware/auth.js"

const DeleteMeSchema = z.object({
  confirm: z.literal(true),
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
      entitlements: entitlementsFor(ent.plan),
      teach_lock: ent.teach_lock,
    })
  })

  router.get("/me/credits", authMiddleware, async (c) => {
    const user = c.get("user")!
    const history = await getCreditHistory(deps.db, user.id, 50)
    return c.json(history)
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

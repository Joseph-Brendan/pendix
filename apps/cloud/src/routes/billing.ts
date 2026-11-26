import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { createCreditPackCheckout, verifyAndSettlePayment } from "../billing/credits-checkout.js"
import {
  FLUTTERWAVE_WEBHOOK_HEADER,
  verifyFlutterwaveWebhookSignature,
  type FlutterwaveClient,
} from "../billing/flutterwave.js"
import {
  cancelUserSubscription,
  createGroupAddSeatsCheckout,
  createGroupCheckout,
  createSubscriptionCheckout,
  createUpgradeCheckout,
  refundPaymentAsAdmin,
  removeGroupSeat,
} from "../billing/subscriptions.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import type { Mailer } from "../mailer.js"
import { requireActiveAccount, requireAuth, type AuthVariables } from "../middleware/auth.js"

const CreditCheckoutSchema = z.object({
  pack: z.enum(["3", "10"]),
  teen_user_id: z.string().uuid().optional(),
})

const SubscribeSchema = z.object({
  plan: z.enum(["solo", "mentored"]),
  period: z.enum(["monthly", "two_month", "yearly"]),
  teen_user_id: z.string().uuid().optional(),
})

const UpgradeSchema = z.object({
  to_plan: z.literal("mentored").default("mentored"),
})

const GroupCheckoutSchema = z.object({
  name: z.string().trim().min(1).max(120).default("My Group"),
  plan: z.enum(["solo", "mentored"]),
  period: z.enum(["monthly", "two_month", "yearly"]),
  seats: z.number().int().min(1).max(1000),
})

const GroupAddSeatsSchema = z.object({
  seats: z.number().int().min(1).max(1000),
})

const GroupRemoveSeatSchema = z.object({
  member_user_id: z.string().uuid().optional(),
  seats: z.number().int().min(1).max(1000).optional(),
})

const RefundBodySchema = z
  .object({
    reason: z.string().trim().max(300).optional(),
  })
  .optional()

const FlutterwaveWebhookSchema = z.object({
  event: z.string().optional(),
  type: z.string().optional(),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      tx_ref: z.string().optional(),
      payment_plan: z.union([z.number(), z.string()]).optional(),
      customer: z
        .object({
          email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

export interface BillingRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly mailer?: Mailer
  readonly flutterwave: FlutterwaveClient
  readonly flwWebhookHash: string
  readonly apiUrl: string
  readonly webUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}

export function createBillingRoutes(deps: BillingRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)
  const activeMiddleware = requireActiveAccount()

  router.get("/billing/summary", authMiddleware, async (c) => {
    const user = c.get("user")!
    const [subRows, paymentRows] = await Promise.all([
      deps.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.user_id, user.id))
        .orderBy(desc(schema.subscriptions.created_at))
        .limit(1),
      deps.db
        .select({
          id: schema.payments.id,
          kind: schema.payments.kind,
          tx_ref: schema.payments.tx_ref,
          amount_cents: schema.payments.amount_cents,
          currency: schema.payments.currency,
          status: schema.payments.status,
          paid_at: schema.payments.paid_at,
          created_at: schema.payments.created_at,
        })
        .from(schema.payments)
        .where(eq(schema.payments.user_id, user.id))
        .orderBy(desc(schema.payments.created_at))
        .limit(50),
    ])

    const sub = subRows[0] ?? null
    return c.json({
      subscription: sub
        ? {
            id: sub.id,
            plan: sub.plan,
            period: sub.period,
            status: sub.status,
            currency: sub.currency,
            current_period_end: sub.current_period_end.toISOString(),
            cancel_at_period_end: sub.cancel_at_period_end,
          }
        : null,
      receipts: paymentRows.map((p) => ({
        id: p.id,
        kind: p.kind,
        tx_ref: p.tx_ref,
        amount_cents: p.amount_cents,
        currency: p.currency,
        status: p.status,
        paid_at: p.paid_at ? p.paid_at.toISOString() : null,
        created_at: p.created_at.toISOString(),
      })),
    })
  })

  router.post("/billing/credits/checkout", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = CreditCheckoutSchema.parse(await c.req.json())

    const checkout = await createCreditPackCheckout({
      db: deps.db,
      flutterwave: deps.flutterwave,
      user,
      pack: body.pack,
      teenUserId: body.teen_user_id,
      apiUrl: deps.apiUrl,
      ngnPricesJson: deps.ngnPricesJson,
      now: deps.now,
    })

    return c.json(checkout, 201)
  })

  router.post("/billing/subscribe", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = SubscribeSchema.parse(await c.req.json())

    const checkout = await createSubscriptionCheckout({
      db: deps.db,
      flutterwave: deps.flutterwave,
      user,
      plan: body.plan,
      period: body.period,
      teenUserId: body.teen_user_id,
      apiUrl: deps.apiUrl,
      ngnPricesJson: deps.ngnPricesJson,
      now: deps.now,
    })

    return c.json(checkout, 201)
  })

  router.post("/billing/cancel", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const result = await cancelUserSubscription({
      db: deps.db,
      flutterwave: deps.flutterwave,
      userId: user.id,
      now: deps.now,
    })
    return c.json(result)
  })

  router.post("/billing/upgrade", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const rawBody = await c.req.json().catch(() => ({}))
    UpgradeSchema.parse(rawBody)

    const checkout = await createUpgradeCheckout({
      db: deps.db,
      flutterwave: deps.flutterwave,
      user,
      apiUrl: deps.apiUrl,
      ngnPricesJson: deps.ngnPricesJson,
      now: deps.now,
    })

    return c.json(checkout, 201)
  })

  router.post("/billing/groups/checkout", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = GroupCheckoutSchema.parse(await c.req.json())

    const checkout = await createGroupCheckout({
      db: deps.db,
      flutterwave: deps.flutterwave,
      user,
      name: body.name,
      plan: body.plan,
      period: body.period,
      seats: body.seats,
      apiUrl: deps.apiUrl,
      ngnPricesJson: deps.ngnPricesJson,
      now: deps.now,
    })

    return c.json(checkout, 201)
  })

  router.post("/billing/groups/:groupId/seats/add", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = GroupAddSeatsSchema.parse(await c.req.json())

    const checkout = await createGroupAddSeatsCheckout({
      db: deps.db,
      flutterwave: deps.flutterwave,
      user,
      groupId: c.req.param("groupId"),
      addedSeats: body.seats,
      apiUrl: deps.apiUrl,
      ngnPricesJson: deps.ngnPricesJson,
      now: deps.now,
    })

    return c.json(checkout, 201)
  })

  router.post("/billing/groups/:groupId/seats/remove", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const body = GroupRemoveSeatSchema.parse(await c.req.json())

    const result = await removeGroupSeat({
      db: deps.db,
      user,
      groupId: c.req.param("groupId"),
      memberUserId: body.member_user_id,
      seats: body.seats,
    })

    return c.json(result)
  })

  router.post("/admin/refunds/:paymentId", authMiddleware, async (c) => {
    const user = c.get("user")!
    const rawBody = await c.req.json().catch(() => undefined)
    const parsed = RefundBodySchema.parse(rawBody)

    const result = await refundPaymentAsAdmin({
      db: deps.db,
      flutterwave: deps.flutterwave,
      adminUser: user,
      paymentId: c.req.param("paymentId"),
      reason: parsed?.reason,
      now: deps.now,
    })

    return c.json(result)
  })

  router.post("/webhooks/flutterwave", async (c) => {
    const signature = c.req.header(FLUTTERWAVE_WEBHOOK_HEADER)
    if (!verifyFlutterwaveWebhookSignature(signature, deps.flwWebhookHash)) {
      throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature.")
    }

    const rawBody = await c.req.json().catch(() => null)
    const parsed = FlutterwaveWebhookSchema.safeParse(rawBody)
    if (!parsed.success || !parsed.data.data?.id) {
      return c.json({ ok: true, ignored: true })
    }

    const result = await verifyAndSettlePayment({
      db: deps.db,
      flutterwave: deps.flutterwave,
      mailer: deps.mailer,
      transactionId: String(parsed.data.data.id),
      expectedTxRef: parsed.data.data.tx_ref,
      fallbackCustomerEmail: parsed.data.data.customer?.email,
      fallbackPaymentPlan:
        parsed.data.data.payment_plan !== undefined ? String(parsed.data.data.payment_plan) : undefined,
      now: deps.now,
    })

    if (result.status === "flagged") {
      c.get("logger")?.warn(
        { paymentId: result.paymentId, txRef: result.txRef, reason: result.reason },
        "flutterwave payment flagged due to verification mismatch",
      )
    }

    return c.json({ ok: true, result })
  })

  router.get("/billing/redirect", async (c) => {
    const transactionId = c.req.query("transaction_id")?.trim()
    const txRef = c.req.query("tx_ref")?.trim() ?? ""
    const rawStatus = c.req.query("status")?.trim() ?? "cancelled"

    let finalStatus = rawStatus
    let creditsAdded = 0

    if (transactionId) {
      const settled = await verifyAndSettlePayment({
        db: deps.db,
        flutterwave: deps.flutterwave,
        mailer: deps.mailer,
        transactionId,
        expectedTxRef: txRef || undefined,
        now: deps.now,
      })
      finalStatus = settled.status === "already_paid" ? "paid" : settled.status
      if (settled.status === "paid") {
        creditsAdded = settled.creditsAdded
      }
    }

    const dashboardUrl = new URL("/billing", deps.webUrl)
    dashboardUrl.searchParams.set("status", finalStatus)
    if (txRef) dashboardUrl.searchParams.set("tx_ref", txRef)

    if (c.req.header("accept")?.includes("application/json")) {
      return c.json({
        status: finalStatus,
        tx_ref: txRef || null,
        credits_added: creditsAdded,
        redirect_url: dashboardUrl.toString(),
      })
    }

    return c.redirect(dashboardUrl.toString(), 302)
  })

  return router
}

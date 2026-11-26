import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { createCreditPackCheckout, verifyAndSettlePayment } from "../billing/credits-checkout.js"
import {
  FLUTTERWAVE_WEBHOOK_HEADER,
  verifyFlutterwaveWebhookSignature,
  type FlutterwaveClient,
} from "../billing/flutterwave.js"
import type { CloudDatabase } from "../db/index.js"
import { AppError } from "../errors.js"
import { requireActiveAccount, requireAuth, type AuthVariables } from "../middleware/auth.js"

const CreditCheckoutSchema = z.object({
  pack: z.enum(["3", "10"]),
  teen_user_id: z.string().uuid().optional(),
})

const FlutterwaveWebhookSchema = z.object({
  event: z.string().optional(),
  type: z.string().optional(),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      tx_ref: z.string().optional(),
    })
    .optional(),
})

export interface BillingRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
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
      transactionId: String(parsed.data.data.id),
      expectedTxRef: parsed.data.data.tx_ref,
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

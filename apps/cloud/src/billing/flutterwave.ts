/**
 * Flutterwave v3 billing client.
 *
 * Flutterwave v3 documentation verified on: 2026-11-26
 * - Standard checkout: POST https://api.flutterwave.com/v3/payments (supports payment_plan for recurring)
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json
 * - Transaction verification: GET https://api.flutterwave.com/v3/transactions/{id}/verify
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json
 * - Payment plans: POST https://api.flutterwave.com/v3/payment-plans, GET https://api.flutterwave.com/v3/payment-plans
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json, accept: application/json
 * - Subscriptions:
 *     GET https://api.flutterwave.com/v3/subscriptions
 *     PUT https://api.flutterwave.com/v3/subscriptions/{id}/cancel
 *     PUT https://api.flutterwave.com/v3/subscriptions/{id}/activate
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json, accept: application/json
 * - Refunds: POST https://api.flutterwave.com/v3/transactions/{id}/refund
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json
 * - Webhooks: POST /webhooks/flutterwave
 *     Signature header: verif-hash (compared in constant time against FLW_WEBHOOK_HASH)
 */
import crypto from "node:crypto"

export const FLUTTERWAVE_V3_BASE_URL = "https://api.flutterwave.com/v3"
export const FLUTTERWAVE_WEBHOOK_HEADER = "verif-hash"

export interface StandardCheckoutInput {
  readonly tx_ref: string
  readonly amount_cents: number
  readonly currency: string
  readonly redirect_url: string
  readonly payment_plan?: string
  readonly customer: {
    readonly email: string
    readonly name: string
  }
  readonly customizations: {
    readonly title: string
    readonly description: string
  }
  readonly meta?: Readonly<Record<string, string | number>>
}

export interface StandardCheckoutResult {
  readonly link: string
}

export interface VerifiedFlutterwaveTransaction {
  readonly id: string
  readonly tx_ref: string
  readonly flw_ref: string
  readonly amount_cents: number
  readonly currency: string
  readonly status: string
  readonly customer_email?: string
  readonly payment_plan?: string
}

export interface FlutterwavePaymentPlan {
  readonly id: string
  readonly name: string
  readonly amount_cents: number
  readonly interval: "monthly" | "yearly" | string
  readonly currency: string
  readonly status: string
  readonly plan_token?: string
}

export interface CreatePaymentPlanInput {
  readonly name: string
  readonly amount_cents: number
  readonly interval: "monthly" | "yearly"
  readonly currency: string
}

export interface FlutterwaveSubscription {
  readonly id: string
  readonly plan: string
  readonly status: string
  readonly customer_email: string
  readonly amount_cents: number
}

export interface FlutterwaveRefundResult {
  readonly id: string
  readonly tx_id: string
  readonly status: string
  readonly amount_refunded_cents: number
}

export interface FlutterwaveClient {
  createStandardCheckout(input: StandardCheckoutInput): Promise<StandardCheckoutResult>
  verifyTransaction(transactionId: string): Promise<VerifiedFlutterwaveTransaction>
  listPaymentPlans(): Promise<FlutterwavePaymentPlan[]>
  createPaymentPlan(input: CreatePaymentPlanInput): Promise<FlutterwavePaymentPlan>
  listSubscriptions(params?: { readonly email?: string; readonly plan?: string }): Promise<FlutterwaveSubscription[]>
  cancelSubscription(subscriptionId: string): Promise<{ readonly id: string; readonly status: string }>
  activateSubscription(subscriptionId: string): Promise<{ readonly id: string; readonly status: string }>
  refundTransaction(
    transactionId: string,
    options?: { readonly amount_cents?: number; readonly comments?: string },
  ): Promise<FlutterwaveRefundResult>
}

export function centsToMajorUnits(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`amount_cents must be a non-negative integer, got ${amountCents}`)
  }
  return Number((amountCents / 100).toFixed(2))
}

export function majorUnitsToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be a non-negative finite number, got ${amount}`)
  }
  return Math.round(amount * 100)
}

export function verifyFlutterwaveWebhookSignature(
  headerValue: string | undefined,
  expectedHash: string | undefined,
): boolean {
  if (!headerValue || !expectedHash) return false
  const received = Buffer.from(headerValue, "utf8")
  const expected = Buffer.from(expectedHash, "utf8")
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(received, expected)
}

export function createFlutterwaveClient(options: {
  readonly secretKey: string
  readonly baseUrl?: string
  readonly fetchFn?: (input: string, init?: RequestInit) => Promise<Response>
}): FlutterwaveClient {
  const baseUrl = (options.baseUrl ?? FLUTTERWAVE_V3_BASE_URL).replace(/\/$/, "")
  const fetchFn = options.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init))

  const authHeaders = () => {
    if (!options.secretKey.trim()) {
      throw new Error("FLW_SECRET_KEY is not configured.")
    }
    return {
      Authorization: `Bearer ${options.secretKey}`,
      "Content-Type": "application/json",
      accept: "application/json",
    }
  }

  return {
    async createStandardCheckout(input) {
      const response = await fetchFn(`${baseUrl}/payments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tx_ref: input.tx_ref,
          amount: centsToMajorUnits(input.amount_cents),
          currency: input.currency,
          redirect_url: input.redirect_url,
          ...(input.payment_plan ? { payment_plan: input.payment_plan } : {}),
          customer: input.customer,
          customizations: input.customizations,
          ...(input.meta ? { meta: input.meta } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })

      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: { link?: string }
      }
      if (!response.ok || body.status !== "success" || typeof body.data?.link !== "string") {
        throw new Error(body.message || `Flutterwave checkout failed with status ${response.status}`)
      }
      return { link: body.data.link }
    },

    async verifyTransaction(transactionId) {
      const response = await fetchFn(`${baseUrl}/transactions/${encodeURIComponent(transactionId)}/verify`, {
        method: "GET",
        headers: authHeaders(),
        signal: AbortSignal.timeout(15_000),
      })

      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: {
          id?: string | number
          tx_ref?: string
          flw_ref?: string
          amount?: number
          currency?: string
          status?: string
          plan?: string | number
          customer?: { email?: string }
        }
      }

      if (!response.ok || body.status !== "success" || !body.data) {
        throw new Error(body.message || `Flutterwave verify failed with status ${response.status}`)
      }

      return {
        id: String(body.data.id ?? transactionId),
        tx_ref: String(body.data.tx_ref ?? ""),
        flw_ref: String(body.data.flw_ref ?? ""),
        amount_cents: majorUnitsToCents(Number(body.data.amount ?? 0)),
        currency: String(body.data.currency ?? "").toUpperCase(),
        status: String(body.data.status ?? "").toLowerCase(),
        customer_email: typeof body.data.customer?.email === "string" ? body.data.customer.email.toLowerCase() : undefined,
        payment_plan: body.data.plan !== undefined && body.data.plan !== null ? String(body.data.plan) : undefined,
      }
    },

    async listPaymentPlans() {
      const plans: FlutterwavePaymentPlan[] = []
      let page = 1
      let totalPages = 1

      while (page <= totalPages && page <= 20) {
        const response = await fetchFn(`${baseUrl}/payment-plans?page=${page}`, {
          method: "GET",
          headers: authHeaders(),
          signal: AbortSignal.timeout(15_000),
        })
        const body = (await response.json().catch(() => ({}))) as {
          status?: string
          message?: string
          meta?: { page_info?: { total_pages?: number } }
          data?: Array<{
            id?: string | number
            name?: string
            amount?: number
            interval?: string
            currency?: string
            status?: string
            plan_token?: string
          }>
        }
        if (!response.ok || body.status !== "success" || !Array.isArray(body.data)) {
          throw new Error(body.message || `Flutterwave list payment plans failed with status ${response.status}`)
        }
        for (const item of body.data) {
          plans.push({
            id: String(item.id ?? ""),
            name: String(item.name ?? ""),
            amount_cents: majorUnitsToCents(Number(item.amount ?? 0)),
            interval: String(item.interval ?? "").toLowerCase(),
            currency: String(item.currency ?? "NGN").toUpperCase(),
            status: String(item.status ?? "").toLowerCase(),
            plan_token: typeof item.plan_token === "string" ? item.plan_token : undefined,
          })
        }
        totalPages = Number(body.meta?.page_info?.total_pages ?? 1)
        page += 1
      }

      return plans
    },

    async createPaymentPlan(input) {
      const response = await fetchFn(`${baseUrl}/payment-plans`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: input.name,
          amount: centsToMajorUnits(input.amount_cents),
          interval: input.interval,
          currency: input.currency,
        }),
        signal: AbortSignal.timeout(15_000),
      })

      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: {
          id?: string | number
          name?: string
          amount?: number
          interval?: string
          currency?: string
          status?: string
          plan_token?: string
        }
      }
      if (!response.ok || body.status !== "success" || !body.data?.id) {
        throw new Error(body.message || `Flutterwave create payment plan failed with status ${response.status}`)
      }
      return {
        id: String(body.data.id),
        name: String(body.data.name ?? input.name),
        amount_cents: majorUnitsToCents(Number(body.data.amount ?? centsToMajorUnits(input.amount_cents))),
        interval: String(body.data.interval ?? input.interval).toLowerCase(),
        currency: String(body.data.currency ?? input.currency).toUpperCase(),
        status: String(body.data.status ?? "active").toLowerCase(),
        plan_token: typeof body.data.plan_token === "string" ? body.data.plan_token : undefined,
      }
    },

    async listSubscriptions(params) {
      const url = new URL(`${baseUrl}/subscriptions`)
      if (params?.email) url.searchParams.set("email", params.email)
      if (params?.plan) url.searchParams.set("plan", params.plan)

      const response = await fetchFn(url.toString(), {
        method: "GET",
        headers: authHeaders(),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: Array<{
          id?: string | number
          plan?: string | number
          status?: string
          amount?: number
          customer?: { customer_email?: string; email?: string }
        }>
      }
      if (!response.ok || body.status !== "success" || !Array.isArray(body.data)) {
        throw new Error(body.message || `Flutterwave list subscriptions failed with status ${response.status}`)
      }
      return body.data.map((item) => ({
        id: String(item.id ?? ""),
        plan: String(item.plan ?? ""),
        status: String(item.status ?? "").toLowerCase(),
        customer_email: String(item.customer?.customer_email ?? item.customer?.email ?? "").toLowerCase(),
        amount_cents: majorUnitsToCents(Number(item.amount ?? 0)),
      }))
    },

    async cancelSubscription(subscriptionId) {
      const response = await fetchFn(`${baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
        method: "PUT",
        headers: authHeaders(),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: { id?: string | number; status?: string }
      }
      if (!response.ok || body.status !== "success") {
        throw new Error(body.message || `Flutterwave cancel subscription failed with status ${response.status}`)
      }
      return {
        id: String(body.data?.id ?? subscriptionId),
        status: String(body.data?.status ?? "cancelled").toLowerCase(),
      }
    },

    async activateSubscription(subscriptionId) {
      const response = await fetchFn(`${baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, {
        method: "PUT",
        headers: authHeaders(),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: { id?: string | number; status?: string }
      }
      if (!response.ok || body.status !== "success") {
        throw new Error(body.message || `Flutterwave activate subscription failed with status ${response.status}`)
      }
      return {
        id: String(body.data?.id ?? subscriptionId),
        status: String(body.data?.status ?? "active").toLowerCase(),
      }
    },

    async refundTransaction(transactionId, refundOptions) {
      const response = await fetchFn(`${baseUrl}/transactions/${encodeURIComponent(transactionId)}/refund`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...(refundOptions?.amount_cents !== undefined
            ? { amount: centsToMajorUnits(refundOptions.amount_cents) }
            : {}),
          ...(refundOptions?.comments ? { comments: refundOptions.comments } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as {
        status?: string
        message?: string
        data?: {
          id?: string | number
          tx_id?: string | number
          status?: string
          amount_refunded?: number
        }
      }
      if (!response.ok || body.status !== "success") {
        throw new Error(body.message || `Flutterwave refund failed with status ${response.status}`)
      }
      return {
        id: String(body.data?.id ?? ""),
        tx_id: String(body.data?.tx_id ?? transactionId),
        status: String(body.data?.status ?? "completed").toLowerCase(),
        amount_refunded_cents: majorUnitsToCents(Number(body.data?.amount_refunded ?? 0)),
      }
    },
  }
}

export interface FakeFlutterwaveRecordedTx {
  readonly id: string
  readonly tx_ref: string
  readonly flw_ref: string
  readonly amount: number
  readonly currency: string
  readonly status: string
  readonly customer_email?: string
  readonly payment_plan?: string
}

export interface FakeFlutterwaveClient extends FlutterwaveClient {
  readonly checkouts: StandardCheckoutInput[]
  readonly verifiedIds: string[]
  readonly paymentPlans: FlutterwavePaymentPlan[]
  readonly cancelledSubscriptionIds: string[]
  readonly activatedSubscriptionIds: string[]
  readonly refundedTransactionIds: string[]
  recordTransaction(tx: FakeFlutterwaveRecordedTx): void
  recordSubscription(sub: FlutterwaveSubscription): void
}

export function createFakeFlutterwaveClient(): FakeFlutterwaveClient {
  const checkouts: StandardCheckoutInput[] = []
  const verifiedIds: string[] = []
  const paymentPlans: FlutterwavePaymentPlan[] = []
  const subscriptions: FlutterwaveSubscription[] = []
  const cancelledSubscriptionIds: string[] = []
  const activatedSubscriptionIds: string[] = []
  const refundedTransactionIds: string[] = []
  const transactions = new Map<string, FakeFlutterwaveRecordedTx>()
  let nextPlanId = 5000

  return {
    checkouts,
    verifiedIds,
    paymentPlans,
    cancelledSubscriptionIds,
    activatedSubscriptionIds,
    refundedTransactionIds,
    recordTransaction(tx) {
      transactions.set(String(tx.id), tx)
    },
    recordSubscription(sub) {
      subscriptions.push(sub)
    },
    async createStandardCheckout(input) {
      checkouts.push(input)
      return {
        link: `https://checkout.flutterwave.com/v3/hosted/pay/${encodeURIComponent(input.tx_ref)}`,
      }
    },
    async verifyTransaction(transactionId) {
      verifiedIds.push(String(transactionId))
      const tx = transactions.get(String(transactionId))
      if (!tx) {
        throw new Error(`No recorded fake Flutterwave transaction for id ${transactionId}`)
      }
      return {
        id: String(tx.id),
        tx_ref: tx.tx_ref,
        flw_ref: tx.flw_ref,
        amount_cents: majorUnitsToCents(tx.amount),
        currency: tx.currency.toUpperCase(),
        status: tx.status.toLowerCase(),
        customer_email: tx.customer_email?.toLowerCase(),
        payment_plan: tx.payment_plan,
      }
    },
    async listPaymentPlans() {
      return [...paymentPlans]
    },
    async createPaymentPlan(input) {
      nextPlanId += 1
      const created: FlutterwavePaymentPlan = {
        id: String(nextPlanId),
        name: input.name,
        amount_cents: input.amount_cents,
        interval: input.interval,
        currency: input.currency.toUpperCase(),
        status: "active",
        plan_token: `rpp_fake_${nextPlanId}`,
      }
      paymentPlans.push(created)
      return created
    },
    async listSubscriptions(params) {
      return subscriptions.filter((s) => {
        if (params?.email && s.customer_email.toLowerCase() !== params.email.toLowerCase()) return false
        if (params?.plan && s.plan !== params.plan) return false
        return true
      })
    },
    async cancelSubscription(subscriptionId) {
      cancelledSubscriptionIds.push(subscriptionId)
      return { id: subscriptionId, status: "cancelled" }
    },
    async activateSubscription(subscriptionId) {
      activatedSubscriptionIds.push(subscriptionId)
      return { id: subscriptionId, status: "active" }
    },
    async refundTransaction(transactionId, options) {
      refundedTransactionIds.push(transactionId)
      return {
        id: `ref_${transactionId}`,
        tx_id: transactionId,
        status: "completed",
        amount_refunded_cents: options?.amount_cents ?? 0,
      }
    },
  }
}

/**
 * Flutterwave v3 billing client.
 *
 * Flutterwave v3 documentation verified on: 2026-11-26
 * - Standard checkout: POST https://api.flutterwave.com/v3/payments
 *     Headers: Authorization: Bearer <FLW_SECRET_KEY>, Content-Type: application/json
 * - Transaction verification: GET https://api.flutterwave.com/v3/transactions/{id}/verify
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
}

export interface FlutterwaveClient {
  createStandardCheckout(input: StandardCheckoutInput): Promise<StandardCheckoutResult>
  verifyTransaction(transactionId: string): Promise<VerifiedFlutterwaveTransaction>
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

  return {
    async createStandardCheckout(input) {
      if (!options.secretKey.trim()) {
        throw new Error("FLW_SECRET_KEY is not configured.")
      }
      const response = await fetchFn(`${baseUrl}/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_ref: input.tx_ref,
          amount: centsToMajorUnits(input.amount_cents),
          currency: input.currency,
          redirect_url: input.redirect_url,
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
      if (!options.secretKey.trim()) {
        throw new Error("FLW_SECRET_KEY is not configured.")
      }
      const response = await fetchFn(`${baseUrl}/transactions/${encodeURIComponent(transactionId)}/verify`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          "Content-Type": "application/json",
        },
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
}

export interface FakeFlutterwaveClient extends FlutterwaveClient {
  readonly checkouts: StandardCheckoutInput[]
  readonly verifiedIds: string[]
  recordTransaction(tx: FakeFlutterwaveRecordedTx): void
}

export function createFakeFlutterwaveClient(): FakeFlutterwaveClient {
  const checkouts: StandardCheckoutInput[] = []
  const verifiedIds: string[] = []
  const transactions = new Map<string, FakeFlutterwaveRecordedTx>()

  return {
    checkouts,
    verifiedIds,
    recordTransaction(tx) {
      transactions.set(String(tx.id), tx)
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
      }
    },
  }
}

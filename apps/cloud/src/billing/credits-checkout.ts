import crypto from "node:crypto"
import { CREDIT_PACKS, type CreditPackId } from "@pendix/shared/plans"
import { and, eq, isNotNull, or } from "drizzle-orm"
import { insertCreditEntry } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import type { AuthenticatedUser } from "../middleware/auth.js"
import type { FlutterwaveClient } from "./flutterwave.js"

export type CreditPackChoice = "3" | "10"

interface NgnPricesMap {
  readonly pack_3?: number
  readonly pack_10?: number
}

function parseNgnPrices(rawJson: string | undefined): NgnPricesMap {
  if (!rawJson?.trim()) return {}
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const result: { pack_3?: number; pack_10?: number } = {}
    if (typeof parsed.pack_3 === "number" && Number.isInteger(parsed.pack_3) && parsed.pack_3 > 0) {
      result.pack_3 = parsed.pack_3
    }
    if (typeof parsed.pack_10 === "number" && Number.isInteger(parsed.pack_10) && parsed.pack_10 > 0) {
      result.pack_10 = parsed.pack_10
    }
    return result
  } catch {
    return {}
  }
}

export function resolveCreditPackPrice(input: {
  readonly pack: CreditPackChoice
  readonly country: string
  readonly ngnPricesJson?: string
}): { readonly packId: CreditPackId; readonly credits: number; readonly amountCents: number; readonly currency: "USD" | "NGN" } {
  const packId: CreditPackId = input.pack === "10" ? "pack_10" : "pack_3"
  const packDef = CREDIT_PACKS[packId]
  const isNigeria = input.country.trim().toUpperCase() === "NG"

  if (isNigeria) {
    const ngnPrices = parseNgnPrices(input.ngnPricesJson)
    const ngnAmount = ngnPrices[packId]
    if (typeof ngnAmount === "number" && Number.isInteger(ngnAmount) && ngnAmount > 0) {
      return {
        packId,
        credits: packDef.credits,
        amountCents: ngnAmount,
        currency: "NGN",
      }
    }
  }

  return {
    packId,
    credits: packDef.credits,
    amountCents: packDef.priceCents,
    currency: "USD",
  }
}

export interface CreateCreditCheckoutResult {
  readonly payment_id: string
  readonly tx_ref: string
  readonly link: string
  readonly amount_cents: number
  readonly currency: "USD" | "NGN"
  readonly credits: number
}

export async function createCreditPackCheckout(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly user: AuthenticatedUser
  readonly pack: CreditPackChoice
  readonly teenUserId?: string
  readonly apiUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}): Promise<CreateCreditCheckoutResult> {
  // SPEC S6 #2: Guardian pays for anything paid. Teens cannot initiate checkout directly.
  if (deps.user.account_kind === "teen") {
    throw new AppError(
      403,
      "TEEN_GUARDIAN_REQUIRED",
      "Teens cannot make purchases. A parent or guardian must sign in to pay.",
    )
  }

  let beneficiaryUserId = deps.user.id
  let pricingCountry = deps.user.country

  if (deps.teenUserId) {
    const [teen] = await deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, deps.teenUserId))

    if (!teen || teen.account_kind !== "teen") {
      throw new AppError(404, "TEEN_NOT_FOUND", "Linked teen account not found.")
    }

    const [guardianLink] = await deps.db
      .select()
      .from(schema.guardians)
      .where(
        and(
          eq(schema.guardians.teen_user_id, teen.id),
          isNotNull(schema.guardians.approved_at),
          or(
            eq(schema.guardians.guardian_user_id, deps.user.id),
            eq(schema.guardians.email, deps.user.email.toLowerCase()),
          ),
        ),
      )

    if (!guardianLink) {
      throw new AppError(403, "GUARDIAN_NOT_LINKED", "You are not an approved guardian for this teen account.")
    }

    beneficiaryUserId = teen.id
    pricingCountry = deps.user.country || teen.country
  }

  const price = resolveCreditPackPrice({
    pack: deps.pack,
    country: pricingCountry,
    ngnPricesJson: deps.ngnPricesJson,
  })

  const txRef = `pdx_cred_${crypto.randomBytes(12).toString("hex")}`
  const nowDate = new Date(deps.now())

  const [paymentRow] = await deps.db
    .insert(schema.payments)
    .values({
      user_id: beneficiaryUserId,
      payer_user_id: deps.user.id,
      kind: "credits",
      tx_ref: txRef,
      amount_cents: price.amountCents,
      currency: price.currency,
      status: "pending",
      metadata: {
        pack: deps.pack,
        pack_id: price.packId,
        credits: price.credits,
        ...(deps.teenUserId ? { teen_user_id: deps.teenUserId } : {}),
      },
      created_at: nowDate,
      updated_at: nowDate,
    })
    .returning()

  const redirectUrl = `${deps.apiUrl.replace(/\/$/, "")}/billing/redirect`
  const checkout = await deps.flutterwave.createStandardCheckout({
    tx_ref: txRef,
    amount_cents: price.amountCents,
    currency: price.currency,
    redirect_url: redirectUrl,
    customer: {
      email: deps.user.email,
      name: deps.user.display_name,
    },
    customizations: {
      title: `Pendix ${price.credits} Credits`,
      description: `One-off pack of ${price.credits} grading credits`,
    },
    meta: {
      payment_id: paymentRow!.id,
      credits: price.credits,
    },
  })

  return {
    payment_id: paymentRow!.id,
    tx_ref: txRef,
    link: checkout.link,
    amount_cents: price.amountCents,
    currency: price.currency,
    credits: price.credits,
  }
}

export type PaymentSettlementResult =
  | { readonly status: "paid"; readonly paymentId: string; readonly creditsAdded: number; readonly txRef: string }
  | { readonly status: "already_paid"; readonly paymentId: string; readonly creditsAdded: number; readonly txRef: string }
  | { readonly status: "flagged"; readonly paymentId: string; readonly creditsAdded: 0; readonly txRef: string; readonly reason: string }
  | { readonly status: "failed"; readonly paymentId: string; readonly creditsAdded: 0; readonly txRef: string }
  | { readonly status: "ignored"; readonly reason: string }

function extractCreditsFromMetadata(metadata: unknown): number {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return 0
  const raw = (metadata as { credits?: unknown }).credits
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0
}

/**
 * Verifies a Flutterwave transaction server-side by transaction id and settles
 * the corresponding pending payment idempotently under a row lock.
 * Never trusts webhook body or redirect query params for money amounts.
 */
export async function verifyAndSettlePayment(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly transactionId: string
  readonly expectedTxRef?: string
  readonly now: () => number
}): Promise<PaymentSettlementResult> {
  const verified = await deps.flutterwave.verifyTransaction(deps.transactionId)
  const lookupTxRef = verified.tx_ref || deps.expectedTxRef || ""
  if (!lookupTxRef) {
    return { status: "ignored", reason: "missing_tx_ref" }
  }

  const nowDate = new Date(deps.now())

  return deps.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.tx_ref, lookupTxRef))
      .for("update")

    if (!payment) {
      return { status: "ignored", reason: "unknown_tx_ref" }
    }

    if (payment.status === "paid") {
      return { status: "already_paid", paymentId: payment.id, creditsAdded: 0, txRef: payment.tx_ref }
    }

    if (payment.status === "flagged") {
      return {
        status: "flagged",
        paymentId: payment.id,
        creditsAdded: 0,
        txRef: payment.tx_ref,
        reason: payment.flag_reason ?? "payment_flagged",
      }
    }

    if (verified.status !== "successful") {
      await tx
        .update(schema.payments)
        .set({
          status: "failed",
          flutterwave_tx_id: verified.id,
          flutterwave_flw_ref: verified.flw_ref,
          updated_at: nowDate,
        })
        .where(eq(schema.payments.id, payment.id))
      return { status: "failed", paymentId: payment.id, creditsAdded: 0, txRef: payment.tx_ref }
    }

    const mismatchReasons: string[] = []
    if (verified.tx_ref !== payment.tx_ref) {
      mismatchReasons.push(`tx_ref mismatch: verified ${verified.tx_ref}, expected ${payment.tx_ref}`)
    }
    if (verified.currency !== payment.currency.toUpperCase()) {
      mismatchReasons.push(`currency mismatch: verified ${verified.currency}, expected ${payment.currency}`)
    }
    if (verified.amount_cents !== payment.amount_cents) {
      mismatchReasons.push(`amount mismatch: verified ${verified.amount_cents} cents, expected ${payment.amount_cents} cents`)
    }

    if (mismatchReasons.length > 0) {
      const reason = mismatchReasons.join("; ")
      await tx
        .update(schema.payments)
        .set({
          status: "flagged",
          flag_reason: reason,
          flutterwave_tx_id: verified.id,
          flutterwave_flw_ref: verified.flw_ref,
          updated_at: nowDate,
        })
        .where(eq(schema.payments.id, payment.id))
      return {
        status: "flagged",
        paymentId: payment.id,
        creditsAdded: 0,
        txRef: payment.tx_ref,
        reason,
      }
    }

    const creditsToAdd = extractCreditsFromMetadata(payment.metadata)
    if (creditsToAdd > 0) {
      const [existingLedger] = await tx
        .select({ id: schema.creditLedger.id })
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.user_id, payment.user_id),
            eq(schema.creditLedger.reason, "purchase"),
            eq(schema.creditLedger.reference_id, payment.id),
          ),
        )

      if (!existingLedger) {
        await insertCreditEntry(tx, {
          userId: payment.user_id,
          amount: creditsToAdd,
          reason: "purchase",
          referenceId: payment.id,
          createdAt: nowDate,
        })
      }
    }

    await tx
      .update(schema.payments)
      .set({
        status: "paid",
        flutterwave_tx_id: verified.id,
        flutterwave_flw_ref: verified.flw_ref,
        paid_at: nowDate,
        updated_at: nowDate,
      })
      .where(eq(schema.payments.id, payment.id))

    return {
      status: "paid",
      paymentId: payment.id,
      creditsAdded: creditsToAdd,
      txRef: payment.tx_ref,
    }
  })
}

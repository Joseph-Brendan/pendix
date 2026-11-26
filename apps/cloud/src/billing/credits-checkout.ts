import crypto from "node:crypto"
import { CREDIT_PACKS, type BillingPeriod, type CreditPackId, type PaidPlanId } from "@pendix/shared/plans"
import { and, eq, isNotNull, or } from "drizzle-orm"
import { insertCreditEntry } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import type { Mailer } from "../mailer.js"
import type { AuthenticatedUser } from "../middleware/auth.js"
import type { FlutterwaveClient } from "./flutterwave.js"
import {
  DAY_MS,
  handleSubscriptionRenewalEvent,
  periodDurationDays,
  scheduleTwoMonthReminder,
} from "./subscriptions.js"

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
  readonly mailer?: Mailer
  readonly transactionId: string
  readonly expectedTxRef?: string
  readonly fallbackCustomerEmail?: string
  readonly fallbackPaymentPlan?: string
  readonly now: () => number
}): Promise<PaymentSettlementResult> {
  const verified = await deps.flutterwave.verifyTransaction(deps.transactionId)
  const lookupTxRef = verified.tx_ref || deps.expectedTxRef || ""
  if (!lookupTxRef) {
    return { status: "ignored", reason: "missing_tx_ref" }
  }

  const nowDate = new Date(deps.now())

  const [existingPayment] = await deps.db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(eq(schema.payments.tx_ref, lookupTxRef))

  if (!existingPayment) {
    const renewal = await handleSubscriptionRenewalEvent({
      db: deps.db,
      mailer: deps.mailer,
      verified,
      fallbackEmail: deps.fallbackCustomerEmail,
      fallbackPlan: deps.fallbackPaymentPlan,
      nowDate,
    })
    if (renewal.status === "renewed") {
      return { status: "paid", paymentId: verified.id, creditsAdded: 0, txRef: lookupTxRef }
    }
    if (renewal.status === "already_processed") {
      return { status: "already_paid", paymentId: verified.id, creditsAdded: 0, txRef: lookupTxRef }
    }
    if (renewal.status === "grace_started") {
      return { status: "failed", paymentId: verified.id, creditsAdded: 0, txRef: lookupTxRef }
    }
    return { status: "ignored", reason: "unknown_tx_ref" }
  }

  // If this is a recurring subscription checkout, look up the Flutterwave subscription id before opening the DB lock.
  let flwSubscriptionId: string | undefined
  if (verified.status === "successful") {
    const [peek] = await deps.db
      .select({ kind: schema.payments.kind, metadata: schema.payments.metadata, payer_user_id: schema.payments.payer_user_id, user_id: schema.payments.user_id })
      .from(schema.payments)
      .where(eq(schema.payments.tx_ref, lookupTxRef))
    const meta = (peek?.metadata ?? {}) as { payment_plan?: string }
    if (peek?.kind === "subscription" && meta.payment_plan) {
      const [payer] = await deps.db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, peek.payer_user_id ?? peek.user_id))
      if (payer?.email) {
        const subs = await deps.flutterwave
          .listSubscriptions({ email: payer.email, plan: meta.payment_plan })
          .catch(() => [])
        flwSubscriptionId = subs.find((s) => s.status === "active")?.id ?? subs[0]?.id
      }
    }
  }

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

    let creditsAdded = 0
    const meta = (payment.metadata ?? {}) as Record<string, unknown>

    if (payment.kind === "credits") {
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
          creditsAdded = creditsToAdd
        }
      }
    } else if (payment.kind === "subscription") {
      const plan = (meta.plan === "mentored" ? "mentored" : "solo") as PaidPlanId
      const period = (
        meta.period === "two_month" || meta.period === "yearly" ? meta.period : "monthly"
      ) as BillingPeriod
      const periodEnd = new Date(nowDate.getTime() + periodDurationDays(period) * DAY_MS)
      const [sub] = await tx
        .insert(schema.subscriptions)
        .values({
          user_id: payment.user_id,
          plan,
          period,
          currency: payment.currency,
          status: "active",
          flutterwave_subscription_id: flwSubscriptionId ?? null,
          flutterwave_plan_id: typeof meta.payment_plan === "string" ? meta.payment_plan : null,
          current_period_start: nowDate,
          current_period_end: periodEnd,
          created_at: nowDate,
          updated_at: nowDate,
        })
        .returning()

      if (period === "two_month" && sub) {
        await scheduleTwoMonthReminder(tx, {
          subscriptionId: sub.id,
          userId: payment.user_id,
          plan,
          periodEnd,
          nowDate,
        })
      }
    } else if (payment.kind === "upgrade") {
      const subscriptionId = typeof meta.subscription_id === "string" ? meta.subscription_id : undefined
      const toPlan = meta.to_plan === "mentored" ? "mentored" : "solo"
      if (subscriptionId) {
        await tx
          .update(schema.subscriptions)
          .set({ plan: toPlan, updated_at: nowDate })
          .where(eq(schema.subscriptions.id, subscriptionId))
      }
    } else if (payment.kind === "group_checkout") {
      const plan = (meta.plan === "mentored" ? "mentored" : "solo") as PaidPlanId
      const period = (
        meta.period === "two_month" || meta.period === "yearly" ? meta.period : "monthly"
      ) as BillingPeriod
      const seats = typeof meta.seats === "number" && Number.isInteger(meta.seats) ? meta.seats : 1
      const groupName = typeof meta.group_name === "string" && meta.group_name.trim() ? meta.group_name.trim() : "My Group"
      const periodEnd = new Date(nowDate.getTime() + periodDurationDays(period) * DAY_MS)

      const [group] = await tx
        .insert(schema.groups)
        .values({
          owner_user_id: payment.user_id,
          name: groupName,
          seat_count: seats,
          created_at: nowDate,
        })
        .returning()

      await tx.insert(schema.groupMembers).values({
        group_id: group!.id,
        user_id: payment.user_id,
        role: "owner",
        seat_plan: plan,
        joined_at: nowDate,
      })

      await tx.insert(schema.subscriptions).values({
        user_id: payment.user_id,
        group_id: group!.id,
        plan,
        period,
        currency: payment.currency,
        status: "active",
        current_period_start: nowDate,
        current_period_end: periodEnd,
        created_at: nowDate,
        updated_at: nowDate,
      })
    } else if (payment.kind === "group_add_seats") {
      const groupId = typeof meta.group_id === "string" ? meta.group_id : undefined
      const addedSeats = typeof meta.added_seats === "number" && Number.isInteger(meta.added_seats) ? meta.added_seats : 0
      if (groupId && addedSeats > 0) {
        const [group] = await tx.select().from(schema.groups).where(eq(schema.groups.id, groupId))
        if (group) {
          await tx
            .update(schema.groups)
            .set({ seat_count: group.seat_count + addedSeats })
            .where(eq(schema.groups.id, groupId))
        }
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
      creditsAdded,
      txRef: payment.tx_ref,
    }
  })
}

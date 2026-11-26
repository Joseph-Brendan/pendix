import crypto from "node:crypto"
import {
  REFUND_WINDOW_DAYS,
  RENEWAL_GRACE_DAYS,
  TWO_MONTH_DURATION_DAYS,
  groupDiscountPercentFor,
  priceFor,
  type BillingPeriod,
  type PaidPlanId,
} from "@pendix/shared/plans"
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import { claimNextJob, enqueueJob } from "../jobs/queue.js"
import type { Mailer } from "../mailer.js"
import type { AuthenticatedUser } from "../middleware/auth.js"
import type { FlutterwaveClient, VerifiedFlutterwaveTransaction } from "./flutterwave.js"

export const DAY_MS = 24 * 60 * 60 * 1000
export const MONTHLY_DURATION_DAYS = 30
export const YEARLY_DURATION_DAYS = 365
export const RENEWAL_REMINDER_DAYS_BEFORE_END = 5
export const RENEWAL_REMINDER_JOB_KIND = "renewal_reminder"

export function periodDurationDays(period: BillingPeriod): number {
  if (period === "two_month") return TWO_MONTH_DURATION_DAYS
  if (period === "yearly") return YEARLY_DURATION_DAYS
  return MONTHLY_DURATION_DAYS
}

function parseNgnPrices(rawJson: string | undefined): Record<string, number> {
  if (!rawJson?.trim()) return {}
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isInteger(v) && v > 0) {
        result[k] = v
      }
    }
    return result
  } catch {
    return {}
  }
}

export function resolvePlanPriceCents(input: {
  readonly plan: PaidPlanId
  readonly period: BillingPeriod
  readonly seats?: number
  readonly country: string
  readonly ngnPricesJson?: string
}): { readonly amountCents: number; readonly currency: "USD" | "NGN" } {
  const seats = input.seats ?? 1
  const isNigeria = input.country.trim().toUpperCase() === "NG"

  if (isNigeria) {
    const ngnMap = parseNgnPrices(input.ngnPricesJson)
    const unitNgn = ngnMap[`${input.plan}_${input.period}`]
    if (typeof unitNgn === "number" && unitNgn > 0) {
      const discount = groupDiscountPercentFor(seats)
      const subtotal = unitNgn * seats
      return {
        amountCents: Math.round((subtotal * (100 - discount)) / 100),
        currency: "NGN",
      }
    }
  }

  return {
    amountCents: priceFor(input.plan, input.period, seats),
    currency: "USD",
  }
}

async function resolveBeneficiaryForPurchase(
  db: CloudDatabase,
  payer: AuthenticatedUser,
  teenUserId?: string,
): Promise<{ readonly beneficiaryUserId: string; readonly pricingCountry: string }> {
  if (payer.account_kind === "teen") {
    throw new AppError(
      403,
      "TEEN_GUARDIAN_REQUIRED",
      "Teens cannot make purchases. A parent or guardian must sign in to pay.",
    )
  }

  if (!teenUserId) {
    return { beneficiaryUserId: payer.id, pricingCountry: payer.country }
  }

  const [teen] = await db.select().from(schema.users).where(eq(schema.users.id, teenUserId))
  if (!teen || teen.account_kind !== "teen") {
    throw new AppError(404, "TEEN_NOT_FOUND", "Linked teen account not found.")
  }

  const [guardianLink] = await db
    .select()
    .from(schema.guardians)
    .where(
      and(
        eq(schema.guardians.teen_user_id, teen.id),
        isNotNull(schema.guardians.approved_at),
        or(
          eq(schema.guardians.guardian_user_id, payer.id),
          eq(schema.guardians.email, payer.email.toLowerCase()),
        ),
      ),
    )

  if (!guardianLink) {
    throw new AppError(403, "GUARDIAN_NOT_LINKED", "You are not an approved guardian for this teen account.")
  }

  return { beneficiaryUserId: teen.id, pricingCountry: payer.country || teen.country }
}

export async function createSubscriptionCheckout(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly user: AuthenticatedUser
  readonly plan: PaidPlanId
  readonly period: BillingPeriod
  readonly teenUserId?: string
  readonly apiUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}) {
  const { beneficiaryUserId, pricingCountry } = await resolveBeneficiaryForPurchase(
    deps.db,
    deps.user,
    deps.teenUserId,
  )

  const price = resolvePlanPriceCents({
    plan: deps.plan,
    period: deps.period,
    country: pricingCountry,
    ngnPricesJson: deps.ngnPricesJson,
  })

  let paymentPlanId: string | undefined
  if (deps.period === "monthly" || deps.period === "yearly") {
    const [planRow] = await deps.db
      .select()
      .from(schema.billingPlans)
      .where(
        and(
          eq(schema.billingPlans.plan, deps.plan),
          eq(schema.billingPlans.period, deps.period),
          eq(schema.billingPlans.currency, price.currency),
        ),
      )

    if (!planRow?.flutterwave_plan_id) {
      throw new AppError(
        503,
        "BILLING_PLAN_NOT_CONFIGURED",
        `Recurring payment plan for ${deps.plan} ${deps.period} (${price.currency}) is not synced yet.`,
      )
    }
    paymentPlanId = planRow.flutterwave_plan_id
  }

  const txRef = `pdx_sub_${crypto.randomBytes(12).toString("hex")}`
  const nowDate = new Date(deps.now())

  const [paymentRow] = await deps.db
    .insert(schema.payments)
    .values({
      user_id: beneficiaryUserId,
      payer_user_id: deps.user.id,
      kind: "subscription",
      tx_ref: txRef,
      amount_cents: price.amountCents,
      currency: price.currency,
      status: "pending",
      metadata: {
        plan: deps.plan,
        period: deps.period,
        ...(paymentPlanId ? { payment_plan: paymentPlanId } : {}),
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
    ...(paymentPlanId ? { payment_plan: paymentPlanId } : {}),
    customer: {
      email: deps.user.email,
      name: deps.user.display_name,
    },
    customizations: {
      title: `Pendix ${deps.plan === "solo" ? "Solo" : "Mentored"} (${deps.period})`,
      description:
        deps.period === "two_month"
          ? `60-day ${deps.plan} plan`
          : `Recurring ${deps.period} ${deps.plan} subscription`,
    },
    meta: {
      payment_id: paymentRow!.id,
      plan: deps.plan,
      period: deps.period,
    },
  })

  return {
    payment_id: paymentRow!.id,
    tx_ref: txRef,
    link: checkout.link,
    amount_cents: price.amountCents,
    currency: price.currency,
    plan: deps.plan,
    period: deps.period,
    ...(paymentPlanId ? { payment_plan: paymentPlanId } : {}),
  }
}

export async function createUpgradeCheckout(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly user: AuthenticatedUser
  readonly apiUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}) {
  if (deps.user.account_kind === "teen") {
    throw new AppError(
      403,
      "TEEN_GUARDIAN_REQUIRED",
      "Teens cannot make purchases. A parent or guardian must sign in to pay.",
    )
  }

  const nowMs = deps.now()
  const nowDate = new Date(nowMs)
  const [activeSub] = await deps.db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.user_id, deps.user.id),
        eq(schema.subscriptions.status, "active"),
        eq(schema.subscriptions.plan, "solo"),
        isNull(schema.subscriptions.group_id),
      ),
    )

  if (!activeSub || activeSub.current_period_end.getTime() <= nowMs) {
    throw new AppError(400, "NO_ACTIVE_SOLO_PLAN", "An active Solo subscription is required to upgrade to Mentored.")
  }

  const period = activeSub.period as BillingPeriod
  const totalDays = periodDurationDays(period)
  const rawDaysLeft = Math.round((activeSub.current_period_end.getTime() - nowMs) / DAY_MS)
  const daysLeft = Math.max(1, Math.min(totalDays, rawDaysLeft))

  const country = activeSub.currency === "NGN" ? "NG" : deps.user.country
  const soloPrice = resolvePlanPriceCents({
    plan: "solo",
    period,
    country,
    ngnPricesJson: deps.ngnPricesJson,
  })
  const mentoredPrice = resolvePlanPriceCents({
    plan: "mentored",
    period,
    country,
    ngnPricesJson: deps.ngnPricesJson,
  })

  const diffCents = Math.max(0, mentoredPrice.amountCents - soloPrice.amountCents)
  const proratedCents = Math.round((diffCents * daysLeft) / totalDays)
  if (proratedCents <= 0) {
    throw new AppError(400, "INVALID_UPGRADE_AMOUNT", "Prorated upgrade amount must be positive.")
  }

  const txRef = `pdx_upg_${crypto.randomBytes(12).toString("hex")}`
  const [paymentRow] = await deps.db
    .insert(schema.payments)
    .values({
      user_id: deps.user.id,
      payer_user_id: deps.user.id,
      kind: "upgrade",
      tx_ref: txRef,
      amount_cents: proratedCents,
      currency: mentoredPrice.currency,
      status: "pending",
      metadata: {
        subscription_id: activeSub.id,
        from_plan: "solo",
        to_plan: "mentored",
        days_left: daysLeft,
        total_days: totalDays,
      },
      created_at: nowDate,
      updated_at: nowDate,
    })
    .returning()

  const redirectUrl = `${deps.apiUrl.replace(/\/$/, "")}/billing/redirect`
  const checkout = await deps.flutterwave.createStandardCheckout({
    tx_ref: txRef,
    amount_cents: proratedCents,
    currency: mentoredPrice.currency,
    redirect_url: redirectUrl,
    customer: {
      email: deps.user.email,
      name: deps.user.display_name,
    },
    customizations: {
      title: "Upgrade to Pendix Mentored",
      description: `Prorated upgrade for ${daysLeft} remaining days`,
    },
    meta: {
      payment_id: paymentRow!.id,
      subscription_id: activeSub.id,
    },
  })

  return {
    payment_id: paymentRow!.id,
    tx_ref: txRef,
    link: checkout.link,
    amount_cents: proratedCents,
    currency: mentoredPrice.currency,
    days_left: daysLeft,
  }
}

export async function cancelUserSubscription(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly userId: string
  readonly now: () => number
}) {
  const nowDate = new Date(deps.now())
  const [activeSub] = await deps.db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.user_id, deps.userId), eq(schema.subscriptions.status, "active")))

  if (!activeSub) {
    throw new AppError(404, "NO_ACTIVE_SUBSCRIPTION", "No active subscription found.")
  }

  if (activeSub.flutterwave_subscription_id) {
    await deps.flutterwave.cancelSubscription(activeSub.flutterwave_subscription_id)
  }

  await deps.db
    .update(schema.subscriptions)
    .set({
      cancel_at_period_end: true,
      updated_at: nowDate,
    })
    .where(eq(schema.subscriptions.id, activeSub.id))

  return {
    subscription_id: activeSub.id,
    cancel_at_period_end: true,
    current_period_end: activeSub.current_period_end.toISOString(),
  }
}

export async function createGroupCheckout(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly user: AuthenticatedUser
  readonly name: string
  readonly plan: PaidPlanId
  readonly period: BillingPeriod
  readonly seats: number
  readonly apiUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}) {
  if (deps.user.account_kind === "teen") {
    throw new AppError(
      403,
      "TEEN_GUARDIAN_REQUIRED",
      "Teens cannot create paid groups.",
    )
  }

  const price = resolvePlanPriceCents({
    plan: deps.plan,
    period: deps.period,
    seats: deps.seats,
    country: deps.user.country,
    ngnPricesJson: deps.ngnPricesJson,
  })

  const txRef = `pdx_grp_${crypto.randomBytes(12).toString("hex")}`
  const nowDate = new Date(deps.now())

  const [paymentRow] = await deps.db
    .insert(schema.payments)
    .values({
      user_id: deps.user.id,
      payer_user_id: deps.user.id,
      kind: "group_checkout",
      tx_ref: txRef,
      amount_cents: price.amountCents,
      currency: price.currency,
      status: "pending",
      metadata: {
        group_name: deps.name,
        plan: deps.plan,
        period: deps.period,
        seats: deps.seats,
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
      title: `Pendix Group (${deps.seats} seats)`,
      description: `${deps.seats} ${deps.plan} seats (${deps.period})`,
    },
    meta: {
      payment_id: paymentRow!.id,
      seats: deps.seats,
    },
  })

  return {
    payment_id: paymentRow!.id,
    tx_ref: txRef,
    link: checkout.link,
    amount_cents: price.amountCents,
    currency: price.currency,
    seats: deps.seats,
  }
}

export async function createGroupAddSeatsCheckout(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly user: AuthenticatedUser
  readonly groupId: string
  readonly addedSeats: number
  readonly apiUrl: string
  readonly ngnPricesJson?: string
  readonly now: () => number
}) {
  const [group] = await deps.db.select().from(schema.groups).where(eq(schema.groups.id, deps.groupId))
  if (!group) {
    throw new AppError(404, "GROUP_NOT_FOUND", "Group not found.")
  }
  if (group.owner_user_id !== deps.user.id) {
    throw new AppError(403, "FORBIDDEN", "Only the group owner can add seats.")
  }

  const nowMs = deps.now()
  const nowDate = new Date(nowMs)
  const [groupSub] = await deps.db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.group_id, group.id), eq(schema.subscriptions.status, "active")))

  if (!groupSub || groupSub.current_period_end.getTime() <= nowMs) {
    throw new AppError(400, "NO_ACTIVE_GROUP_SUBSCRIPTION", "Group does not have an active subscription.")
  }

  const plan = groupSub.plan as PaidPlanId
  const period = groupSub.period as BillingPeriod
  const totalDays = periodDurationDays(period)
  const rawDaysLeft = Math.round((groupSub.current_period_end.getTime() - nowMs) / DAY_MS)
  const daysLeft = Math.max(1, Math.min(totalDays, rawDaysLeft))
  const newTotalSeats = group.seat_count + deps.addedSeats
  const country = groupSub.currency === "NGN" ? "NG" : deps.user.country

  const fullNewTierPrice = resolvePlanPriceCents({
    plan,
    period,
    seats: newTotalSeats,
    country,
    ngnPricesJson: deps.ngnPricesJson,
  })
  const discountedPerSeatCents = Math.round(fullNewTierPrice.amountCents / newTotalSeats)
  const proratedCents = Math.round((discountedPerSeatCents * deps.addedSeats * daysLeft) / totalDays)

  const txRef = `pdx_seat_${crypto.randomBytes(12).toString("hex")}`
  const [paymentRow] = await deps.db
    .insert(schema.payments)
    .values({
      user_id: deps.user.id,
      payer_user_id: deps.user.id,
      kind: "group_add_seats",
      tx_ref: txRef,
      amount_cents: proratedCents,
      currency: fullNewTierPrice.currency,
      status: "pending",
      metadata: {
        group_id: group.id,
        added_seats: deps.addedSeats,
        days_left: daysLeft,
      },
      created_at: nowDate,
      updated_at: nowDate,
    })
    .returning()

  const redirectUrl = `${deps.apiUrl.replace(/\/$/, "")}/billing/redirect`
  const checkout = await deps.flutterwave.createStandardCheckout({
    tx_ref: txRef,
    amount_cents: proratedCents,
    currency: fullNewTierPrice.currency,
    redirect_url: redirectUrl,
    customer: {
      email: deps.user.email,
      name: deps.user.display_name,
    },
    customizations: {
      title: `Add ${deps.addedSeats} Pendix seats`,
      description: `Prorated for ${daysLeft} remaining days`,
    },
    meta: {
      payment_id: paymentRow!.id,
      group_id: group.id,
      added_seats: deps.addedSeats,
    },
  })

  return {
    payment_id: paymentRow!.id,
    tx_ref: txRef,
    link: checkout.link,
    amount_cents: proratedCents,
    currency: fullNewTierPrice.currency,
    added_seats: deps.addedSeats,
  }
}

export async function removeGroupSeat(deps: {
  readonly db: CloudDatabase
  readonly user: AuthenticatedUser
  readonly groupId: string
  readonly memberUserId?: string
  readonly seats?: number
}) {
  const [group] = await deps.db.select().from(schema.groups).where(eq(schema.groups.id, deps.groupId))
  if (!group) {
    throw new AppError(404, "GROUP_NOT_FOUND", "Group not found.")
  }
  if (group.owner_user_id !== deps.user.id) {
    throw new AppError(403, "FORBIDDEN", "Only the group owner can remove seats.")
  }

  const [groupSub] = await deps.db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.group_id, group.id), eq(schema.subscriptions.status, "active")))

  if (!groupSub) {
    throw new AppError(400, "NO_ACTIVE_GROUP_SUBSCRIPTION", "Group does not have an active subscription.")
  }

  const removeCount = deps.seats ?? 1
  if (deps.memberUserId) {
    await deps.db
      .update(schema.groupMembers)
      .set({ ends_at: groupSub.current_period_end })
      .where(and(eq(schema.groupMembers.group_id, group.id), eq(schema.groupMembers.user_id, deps.memberUserId)))
  }

  await deps.db
    .update(schema.groups)
    .set({ pending_seat_removals: group.pending_seat_removals + removeCount })
    .where(eq(schema.groups.id, group.id))

  return {
    group_id: group.id,
    ends_at: groupSub.current_period_end.toISOString(),
    pending_seat_removals: group.pending_seat_removals + removeCount,
  }
}

export async function handleSubscriptionRenewalEvent(deps: {
  readonly db: CloudDatabase
  readonly mailer?: Mailer
  readonly verified: VerifiedFlutterwaveTransaction
  readonly fallbackEmail?: string
  readonly fallbackPlan?: string
  readonly nowDate: Date
}): Promise<{ readonly status: "renewed" | "grace_started" | "already_processed" | "ignored" }> {
  const [existingTx] = await deps.db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(eq(schema.payments.flutterwave_tx_id, deps.verified.id))

  if (existingTx) {
    return { status: "already_processed" }
  }

  const email = (deps.verified.customer_email ?? deps.fallbackEmail ?? "").trim().toLowerCase()
  if (!email) {
    return { status: "ignored" }
  }

  const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.email, email))
  if (!user) {
    return { status: "ignored" }
  }

  const planId = deps.verified.payment_plan ?? deps.fallbackPlan
  const subRows = await deps.db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.user_id, user.id))

  const sub =
    (planId ? subRows.find((s) => s.flutterwave_plan_id === planId) : undefined) ??
    subRows.find((s) => s.status === "active" || s.status === "past_due")

  if (!sub) {
    return { status: "ignored" }
  }

  if (deps.verified.status === "successful") {
    const days = periodDurationDays(sub.period as BillingPeriod)
    const baseMs = Math.max(deps.nowDate.getTime(), sub.current_period_end.getTime())
    const nextPeriodEnd = new Date(baseMs + days * DAY_MS)

    await deps.db.transaction(async (tx) => {
      await tx.insert(schema.payments).values({
        user_id: user.id,
        payer_user_id: user.id,
        kind: "renewal",
        tx_ref: deps.verified.tx_ref || `flw_renew_${deps.verified.id}`,
        flutterwave_tx_id: deps.verified.id,
        flutterwave_flw_ref: deps.verified.flw_ref,
        amount_cents: deps.verified.amount_cents,
        currency: deps.verified.currency,
        status: "paid",
        metadata: { subscription_id: sub.id },
        paid_at: deps.nowDate,
        created_at: deps.nowDate,
        updated_at: deps.nowDate,
      })

      await tx
        .update(schema.subscriptions)
        .set({
          status: "active",
          current_period_start: new Date(baseMs),
          current_period_end: nextPeriodEnd,
          grace_until: null,
          updated_at: deps.nowDate,
        })
        .where(eq(schema.subscriptions.id, sub.id))
    })

    return { status: "renewed" }
  }

  // Failed renewal: start 3-day grace window and notify user.
  const graceUntil = new Date(deps.nowDate.getTime() + RENEWAL_GRACE_DAYS * DAY_MS)
  await deps.db.transaction(async (tx) => {
    await tx.insert(schema.payments).values({
      user_id: user.id,
      payer_user_id: user.id,
      kind: "renewal",
      tx_ref: deps.verified.tx_ref || `flw_renew_fail_${deps.verified.id}`,
      flutterwave_tx_id: deps.verified.id,
      flutterwave_flw_ref: deps.verified.flw_ref,
      amount_cents: deps.verified.amount_cents,
      currency: deps.verified.currency,
      status: "failed",
      metadata: { subscription_id: sub.id },
      created_at: deps.nowDate,
      updated_at: deps.nowDate,
    })

    await tx
      .update(schema.subscriptions)
      .set({
        status: "past_due",
        grace_until: graceUntil,
        updated_at: deps.nowDate,
      })
      .where(eq(schema.subscriptions.id, sub.id))
  })

  if (deps.mailer) {
    await deps.mailer
      .send({
        to: user.email,
        subject: "Your Pendix renewal failed",
        text: `Hi ${user.display_name},\n\nWe could not renew your Pendix ${sub.plan} plan. You have a ${RENEWAL_GRACE_DAYS}-day grace period until ${graceUntil.toISOString().slice(0, 10)} before your account moves to Free.`,
        html: `<p>Hi ${user.display_name},</p><p>We could not renew your Pendix ${sub.plan} plan. You have a ${RENEWAL_GRACE_DAYS}-day grace period until ${graceUntil.toISOString().slice(0, 10)} before your account moves to Free.</p>`,
      })
      .catch(() => undefined)
  }

  return { status: "grace_started" }
}

export async function expireGraceSubscriptions(
  db: CloudDatabase,
  mailer: Mailer,
  now = new Date(),
): Promise<number> {
  const expiredSubs = await db
    .select({
      id: schema.subscriptions.id,
      user_id: schema.subscriptions.user_id,
      plan: schema.subscriptions.plan,
      email: schema.users.email,
      display_name: schema.users.display_name,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.users, eq(schema.subscriptions.user_id, schema.users.id))
    .where(and(eq(schema.subscriptions.status, "past_due"), lte(schema.subscriptions.grace_until, now)))

  for (const sub of expiredSubs) {
    await db
      .update(schema.subscriptions)
      .set({
        status: "expired",
        grace_until: null,
        updated_at: now,
      })
      .where(eq(schema.subscriptions.id, sub.id))

    await mailer
      .send({
        to: sub.email,
        subject: "Your Pendix plan moved to Free",
        text: `Hi ${sub.display_name},\n\nYour ${RENEWAL_GRACE_DAYS}-day grace period has ended and your Pendix ${sub.plan} plan has moved to Free. You can still use Pendix with your own model keys and teach mode, or renew anytime.`,
        html: `<p>Hi ${sub.display_name},</p><p>Your ${RENEWAL_GRACE_DAYS}-day grace period has ended and your Pendix ${sub.plan} plan has moved to Free. You can still use Pendix with your own model keys and teach mode, or renew anytime.</p>`,
      })
      .catch(() => undefined)
  }

  return expiredSubs.length
}

export async function processNextRenewalReminderJob(deps: {
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly webUrl: string
  readonly now?: () => number
}): Promise<{ readonly sent: boolean; readonly jobId: string } | null> {
  const nowFn = deps.now ?? (() => Date.now())
  const nowDate = new Date(nowFn())
  const job = await claimNextJob(deps.db, RENEWAL_REMINDER_JOB_KIND, nowDate)
  if (!job) return null

  const payload = job.payload as { user_id?: string; plan?: string; period_end?: string }
  if (!payload.user_id) {
    await deps.db
      .update(schema.jobs)
      .set({ status: "failed", last_error: "Missing user_id", updated_at: nowDate })
      .where(eq(schema.jobs.id, job.id))
    return { sent: false, jobId: job.id }
  }

  const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.id, payload.user_id))
  if (user) {
    const renewUrl = `${deps.webUrl.replace(/\/$/, "")}/billing`
    const endDate = payload.period_end ? payload.period_end.slice(0, 10) : "in 5 days"
    await deps.mailer.send({
      to: user.email,
      subject: "Your Pendix two-month plan ends in 5 days",
      text: `Hi ${user.display_name},\n\nYour Pendix ${payload.plan ?? ""} two-month plan ends on ${endDate}. Renew anytime at ${renewUrl}.`,
      html: `<p>Hi ${user.display_name},</p><p>Your Pendix ${payload.plan ?? ""} two-month plan ends on ${endDate}. <a href="${renewUrl}">Renew your plan</a>.</p>`,
    })
  }

  await deps.db
    .update(schema.jobs)
    .set({ status: "completed", updated_at: nowDate })
    .where(eq(schema.jobs.id, job.id))

  return { sent: Boolean(user), jobId: job.id }
}

export async function refundPaymentAsAdmin(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly adminUser: AuthenticatedUser
  readonly paymentId: string
  readonly reason?: string
  readonly now: () => number
}) {
  if (deps.adminUser.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "Admin access required.")
  }

  const [payment] = await deps.db.select().from(schema.payments).where(eq(schema.payments.id, deps.paymentId))
  if (!payment) {
    throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.")
  }
  if (payment.status !== "paid" || !payment.flutterwave_tx_id) {
    throw new AppError(400, "PAYMENT_NOT_REFUNDABLE", "Only paid Flutterwave payments can be refunded.")
  }

  // SPEC S8: Refunds within 7 days of first payment.
  const [firstPayment] = await deps.db
    .select({ id: schema.payments.id, paid_at: schema.payments.paid_at, created_at: schema.payments.created_at })
    .from(schema.payments)
    .where(and(eq(schema.payments.user_id, payment.user_id), eq(schema.payments.status, "paid")))
    .orderBy(asc(schema.payments.created_at))
    .limit(1)

  const paidTimestamp = (payment.paid_at ?? payment.created_at).getTime()
  const nowMs = deps.now()
  const nowDate = new Date(nowMs)
  const isFirstPayment = !firstPayment || firstPayment.id === payment.id
  const withinWindow = nowMs - paidTimestamp <= REFUND_WINDOW_DAYS * DAY_MS

  if (!isFirstPayment || !withinWindow) {
    throw new AppError(
      400,
      "REFUND_WINDOW_EXPIRED",
      `Refunds are only available within ${REFUND_WINDOW_DAYS} days of the first payment.`,
    )
  }

  const flwRefund = await deps.flutterwave.refundTransaction(payment.flutterwave_tx_id, {
    amount_cents: payment.amount_cents,
    comments: deps.reason ?? "Admin refund within 7-day window",
  })

  await deps.db.transaction(async (tx) => {
    await tx
      .update(schema.payments)
      .set({
        status: "refunded",
        updated_at: nowDate,
      })
      .where(eq(schema.payments.id, payment.id))

    await tx
      .update(schema.subscriptions)
      .set({
        status: "refunded",
        current_period_end: nowDate,
        grace_until: null,
        updated_at: nowDate,
      })
      .where(eq(schema.subscriptions.user_id, payment.user_id))

    const learnerMatches = await tx
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.learner_user_id, payment.user_id))

    if (learnerMatches.length > 0) {
      await tx
        .update(schema.matches)
        .set({ refund_flagged_at: nowDate })
        .where(eq(schema.matches.learner_user_id, payment.user_id))

      // Insert-only earnings_ledger reversal if positive earnings were already recorded for these matches.
      for (const match of learnerMatches) {
        const earnings = await tx
          .select()
          .from(schema.earningsLedger)
          .where(
            and(
              eq(schema.earningsLedger.mentor_user_id, match.mentor_user_id),
              eq(schema.earningsLedger.reference_id, match.id),
            ),
          )
        const net = earnings.reduce((sum, row) => sum + row.delta_cents, 0)
        if (net > 0) {
          await tx.insert(schema.earningsLedger).values({
            mentor_user_id: match.mentor_user_id,
            delta_cents: -net,
            reason: "refund_excluded",
            reference_id: match.id,
            created_at: nowDate,
          })
        }
      }
    }

    await tx.insert(schema.auditLog).values({
      actor_user_id: deps.adminUser.id,
      action: "payment.refund",
      target_type: "payment",
      target_id: payment.id,
      before: { status: payment.status, amount_cents: payment.amount_cents },
      after: { status: "refunded", flutterwave_refund_id: flwRefund.id },
      created_at: nowDate,
    })
  })

  return {
    payment_id: payment.id,
    status: "refunded",
    flutterwave_refund_id: flwRefund.id,
    amount_cents: payment.amount_cents,
  }
}

export async function scheduleTwoMonthReminder(
  tx: Parameters<Parameters<CloudDatabase["transaction"]>[0]>[0],
  input: {
    readonly subscriptionId: string
    readonly userId: string
    readonly plan: string
    readonly periodEnd: Date
    readonly nowDate: Date
  },
): Promise<void> {
  const reminderAt = new Date(input.periodEnd.getTime() - RENEWAL_REMINDER_DAYS_BEFORE_END * DAY_MS)
  await enqueueJob(tx, {
    kind: RENEWAL_REMINDER_JOB_KIND,
    payload: {
      subscription_id: input.subscriptionId,
      user_id: input.userId,
      plan: input.plan,
      period_end: input.periodEnd.toISOString(),
    },
    runAt: reminderAt,
    createdAt: input.nowDate,
  })
}

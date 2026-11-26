import { priceFor, type PaidPlanId } from "@pendix/shared/plans"
import { and, eq } from "drizzle-orm"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import type { FlutterwaveClient } from "./flutterwave.js"

export type RecurringPeriod = "monthly" | "yearly"

export interface PlanSyncEntry {
  readonly plan: PaidPlanId
  readonly period: RecurringPeriod
  readonly currency: "USD" | "NGN"
  readonly amount_cents: number
  readonly flutterwave_plan_id: string
  readonly created: boolean
}

export interface SyncFlutterwavePlansResult {
  readonly created: number
  readonly existing: number
  readonly plans: readonly PlanSyncEntry[]
}

const RECURRING_PLANS: readonly PaidPlanId[] = ["solo", "mentored"]
const RECURRING_PERIODS: readonly RecurringPeriod[] = ["monthly", "yearly"]

function parseNgnPlanPrices(rawJson: string | undefined): Record<string, number> {
  if (!rawJson?.trim()) return {}
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const map: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        map[key] = value
      }
    }
    return map
  } catch {
    return {}
  }
}

export function canonicalPlanName(plan: PaidPlanId, period: RecurringPeriod, currency: "USD" | "NGN"): string {
  const planTitle = plan === "solo" ? "Solo" : "Mentored"
  const periodTitle = period === "monthly" ? "Monthly" : "Yearly"
  return `Pendix ${planTitle} ${periodTitle} (${currency})`
}

/**
 * Idempotently creates or finds Flutterwave v3 recurring payment plans for
 * solo and mentored, monthly and yearly, in USD and NGN (when NGN prices are configured),
 * and stores their IDs in billing_plans.
 */
export async function syncFlutterwavePlans(deps: {
  readonly db: CloudDatabase
  readonly flutterwave: FlutterwaveClient
  readonly ngnPricesJson?: string
}): Promise<SyncFlutterwavePlansResult> {
  const ngnPrices = parseNgnPlanPrices(deps.ngnPricesJson)
  const targets: Array<{
    readonly plan: PaidPlanId
    readonly period: RecurringPeriod
    readonly currency: "USD" | "NGN"
    readonly amount_cents: number
  }> = []

  for (const plan of RECURRING_PLANS) {
    for (const period of RECURRING_PERIODS) {
      targets.push({
        plan,
        period,
        currency: "USD",
        amount_cents: priceFor(plan, period),
      })

      const ngnKey = `${plan}_${period}`
      const ngnAmount = ngnPrices[ngnKey]
      if (typeof ngnAmount === "number" && ngnAmount > 0) {
        targets.push({
          plan,
          period,
          currency: "NGN",
          amount_cents: ngnAmount,
        })
      }
    }
  }

  let remotePlans: Awaited<ReturnType<FlutterwaveClient["listPaymentPlans"]>> | undefined
  const entries: PlanSyncEntry[] = []
  let createdCount = 0
  let existingCount = 0

  for (const target of targets) {
    const [existingRow] = await deps.db
      .select()
      .from(schema.billingPlans)
      .where(
        and(
          eq(schema.billingPlans.plan, target.plan),
          eq(schema.billingPlans.period, target.period),
          eq(schema.billingPlans.currency, target.currency),
        ),
      )

    if (existingRow?.flutterwave_plan_id && existingRow.amount_cents === target.amount_cents) {
      existingCount += 1
      entries.push({
        plan: target.plan,
        period: target.period,
        currency: target.currency,
        amount_cents: target.amount_cents,
        flutterwave_plan_id: existingRow.flutterwave_plan_id,
        created: false,
      })
      continue
    }

    if (!remotePlans) {
      remotePlans = await deps.flutterwave.listPaymentPlans()
    }

    const name = canonicalPlanName(target.plan, target.period, target.currency)
    let matched = remotePlans.find(
      (remote) =>
        remote.status === "active" &&
        remote.name === name &&
        remote.interval === target.period &&
        remote.currency === target.currency &&
        remote.amount_cents === target.amount_cents,
    )

    let createdRemote = false
    if (!matched) {
      matched = await deps.flutterwave.createPaymentPlan({
        name,
        amount_cents: target.amount_cents,
        interval: target.period,
        currency: target.currency,
      })
      remotePlans.push(matched)
      createdRemote = true
    }

    if (existingRow) {
      await deps.db
        .update(schema.billingPlans)
        .set({
          amount_cents: target.amount_cents,
          flutterwave_plan_id: matched.id,
        })
        .where(eq(schema.billingPlans.id, existingRow.id))
    } else {
      await deps.db.insert(schema.billingPlans).values({
        plan: target.plan,
        period: target.period,
        currency: target.currency,
        amount_cents: target.amount_cents,
        flutterwave_plan_id: matched.id,
      })
    }

    if (createdRemote) {
      createdCount += 1
    } else {
      existingCount += 1
    }

    entries.push({
      plan: target.plan,
      period: target.period,
      currency: target.currency,
      amount_cents: target.amount_cents,
      flutterwave_plan_id: matched.id,
      created: createdRemote,
    })
  }

  return {
    created: createdCount,
    existing: existingCount,
    plans: entries,
  }
}

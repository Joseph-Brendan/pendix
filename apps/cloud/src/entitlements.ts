import { CREDIT_COSTS, entitlementsFor, type PlanId } from "@pendix/shared/plans"
import { normalizeTeachLock } from "@pendix/shared/teach"
import type { TeachLock } from "@pendix/shared/types"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { getCreditBalance, type DbExecutor } from "./credits.js"
import { schema } from "./db/schema.js"

export interface UserEntitlements {
  readonly plan: PlanId
  readonly source: "personal" | string
  readonly period_end: string | null
  readonly graded_sessions_this_month: number
  readonly fair_use_remaining: number
  readonly credit_balance: number
  readonly can_grade: boolean
  readonly can_assess: boolean
  readonly has_mentor: boolean
  readonly teach_lock: TeachLock
}

const PLAN_RANK: Readonly<Record<PlanId, number>> = {
  free: 0,
  solo: 1,
  mentored: 2,
}

function normalizePlan(value: string | null | undefined): PlanId {
  if (value === "solo" || value === "mentored") return value
  return "free"
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

function isSubscriptionEffective(
  sub: {
    readonly status: string
    readonly current_period_end: Date
    readonly grace_until: Date | null
  },
  now: Date,
): boolean {
  const nowMs = now.getTime()
  if (sub.status === "active") {
    return sub.current_period_end.getTime() > nowMs || (sub.grace_until !== null && sub.grace_until.getTime() > nowMs)
  }
  if (sub.status === "past_due") {
    return sub.grace_until !== null && sub.grace_until.getTime() > nowMs
  }
  return false
}

export async function getEntitlements(
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<UserEntitlements> {
  const monthStart = startOfUtcMonth(now)

  const [[userRow], subRows, groupRows, [monthCountRow], creditBalance] = await Promise.all([
    db
      .select({ teach_lock: schema.users.teach_lock })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    db
      .select({
        plan: schema.subscriptions.plan,
        group_id: schema.subscriptions.group_id,
        status: schema.subscriptions.status,
        current_period_end: schema.subscriptions.current_period_end,
        grace_until: schema.subscriptions.grace_until,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.user_id, userId)),
    db
      .select({
        group_id: schema.groupMembers.group_id,
        seat_plan: schema.groupMembers.seat_plan,
        ends_at: schema.groupMembers.ends_at,
        teach_lock: schema.groups.teach_lock,
      })
      .from(schema.groupMembers)
      .innerJoin(schema.groups, eq(schema.groupMembers.group_id, schema.groups.id))
      .where(eq(schema.groupMembers.user_id, userId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.user_id, userId),
          gte(schema.sessions.created_at, monthStart),
          inArray(schema.sessions.status, ["queued", "grading", "graded"]),
        ),
      ),
    getCreditBalance(db, userId),
  ])

  let bestPlan: PlanId = "free"
  let bestSource: "personal" | string = "personal"
  let bestPeriodEnd: Date | null = null

  for (const sub of subRows) {
    if (!isSubscriptionEffective(sub, now)) continue
    const candidatePlan = normalizePlan(sub.plan)
    if (PLAN_RANK[candidatePlan] > PLAN_RANK[bestPlan]) {
      bestPlan = candidatePlan
      bestSource = sub.group_id ?? "personal"
      bestPeriodEnd = sub.current_period_end
    }
  }

  const paidGroupSeats = groupRows.filter(
    (row) => normalizePlan(row.seat_plan) !== "free" && (row.ends_at === null || row.ends_at.getTime() > now.getTime()),
  )
  if (paidGroupSeats.length > 0) {
    const groupIds = paidGroupSeats.map((row) => row.group_id)
    const groupSubs = await db
      .select({
        group_id: schema.subscriptions.group_id,
        status: schema.subscriptions.status,
        current_period_end: schema.subscriptions.current_period_end,
        grace_until: schema.subscriptions.grace_until,
      })
      .from(schema.subscriptions)
      .where(inArray(schema.subscriptions.group_id, groupIds))

    const periodByGroup = new Map<string, Date>()
    const groupsWithAnySub = new Set<string>()
    for (const sub of groupSubs) {
      if (!sub.group_id) continue
      groupsWithAnySub.add(sub.group_id)
      if (!isSubscriptionEffective(sub, now)) continue
      const existing = periodByGroup.get(sub.group_id)
      if (!existing || sub.current_period_end.getTime() > existing.getTime()) {
        periodByGroup.set(sub.group_id, sub.current_period_end)
      }
    }

    for (const seat of paidGroupSeats) {
      if (groupsWithAnySub.has(seat.group_id) && !periodByGroup.has(seat.group_id)) continue
      const candidatePlan = normalizePlan(seat.seat_plan)
      if (PLAN_RANK[candidatePlan] > PLAN_RANK[bestPlan]) {
        bestPlan = candidatePlan
        bestSource = seat.group_id
        bestPeriodEnd = periodByGroup.get(seat.group_id) ?? seat.ends_at ?? null
      }
    }
  }

  const hasClassLock = groupRows.some((row) => row.teach_lock === "class")
  const userLock = normalizeTeachLock(userRow?.teach_lock)
  const teachLock: TeachLock = hasClassLock ? "class" : userLock === "self" ? "self" : "none"

  const planSpec = entitlementsFor(bestPlan)
  const gradedSessionsThisMonth = monthCountRow?.count ?? 0
  const fairUseRemaining = Math.max(0, planSpec.fairUseGradedSessionsPerMonth - gradedSessionsThisMonth)

  return {
    plan: bestPlan,
    source: bestSource,
    period_end: bestPeriodEnd ? bestPeriodEnd.toISOString() : null,
    graded_sessions_this_month: gradedSessionsThisMonth,
    fair_use_remaining: fairUseRemaining,
    credit_balance: creditBalance,
    can_grade: fairUseRemaining > 0 || creditBalance >= CREDIT_COSTS.sessionGrade,
    can_assess: planSpec.assessments || creditBalance >= CREDIT_COSTS.assessment,
    has_mentor: planSpec.humanMentor,
    teach_lock: teachLock,
  }
}

export const entitlements = getEntitlements

export type PlanId = "free" | "solo" | "mentored"
export type PaidPlanId = Exclude<PlanId, "free">
export type BillingPeriod = "monthly" | "two_month" | "yearly"
export type CreditPackId = "pack_3" | "pack_10"

export interface CreditPack {
  readonly credits: number
  readonly priceCents: number
}

export interface GroupDiscountTier {
  readonly minSeats: number
  readonly maxSeats: number | null
  readonly discountPercent: number
}

export interface PlanEntitlements {
  readonly agent: boolean
  readonly modelList: boolean
  readonly ownKeys: boolean
  readonly freeModels: boolean
  readonly teachMode: boolean
  readonly grading: boolean
  readonly notes: boolean
  readonly assessments: boolean
  readonly humanMentor: boolean
  readonly fairUseGradedSessionsPerMonth: number
}

export interface PlanDefinition {
  readonly id: PlanId
  readonly name: string
  readonly prices: Readonly<Record<BillingPeriod, number>>
  readonly entitlements: PlanEntitlements
}

export const FAIR_USE_GRADED_SESSIONS_PER_MONTH = 100
export const TWO_MONTH_DURATION_DAYS = 60
export const REFUND_WINDOW_DAYS = 7
export const RENEWAL_GRACE_DAYS = 3

export const CREDIT_PACKS: Readonly<Record<CreditPackId, CreditPack>> = {
  pack_3: { credits: 3, priceCents: 200 },
  pack_10: { credits: 10, priceCents: 500 },
} as const

export const CREDIT_COSTS = {
  sessionGrade: 1,
  assessment: 2,
} as const

export const GROUP_DISCOUNT_TIERS: readonly GroupDiscountTier[] = [
  { minSeats: 5, maxSeats: 19, discountPercent: 15 },
  { minSeats: 20, maxSeats: null, discountPercent: 25 },
] as const

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: "free",
    name: "Free",
    prices: {
      monthly: 0,
      two_month: 0,
      yearly: 0,
    },
    entitlements: {
      agent: true,
      modelList: true,
      ownKeys: true,
      freeModels: true,
      teachMode: true,
      grading: false,
      notes: false,
      assessments: false,
      humanMentor: false,
      fairUseGradedSessionsPerMonth: 0,
    },
  },
  solo: {
    id: "solo",
    name: "Solo",
    prices: {
      monthly: 1000,
      two_month: 1500,
      yearly: 7200,
    },
    entitlements: {
      agent: true,
      modelList: true,
      ownKeys: true,
      freeModels: true,
      teachMode: true,
      grading: true,
      notes: true,
      assessments: true,
      humanMentor: false,
      fairUseGradedSessionsPerMonth: FAIR_USE_GRADED_SESSIONS_PER_MONTH,
    },
  },
  mentored: {
    id: "mentored",
    name: "Mentored",
    prices: {
      monthly: 2500,
      two_month: 4500,
      yearly: 24000,
    },
    entitlements: {
      agent: true,
      modelList: true,
      ownKeys: true,
      freeModels: true,
      teachMode: true,
      grading: true,
      notes: true,
      assessments: true,
      humanMentor: true,
      fairUseGradedSessionsPerMonth: FAIR_USE_GRADED_SESSIONS_PER_MONTH,
    },
  },
} as const

export function groupDiscountPercentFor(seats: number): number {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new RangeError(`seats must be a positive integer, got ${seats}`)
  }
  const tier = GROUP_DISCOUNT_TIERS.find(
    (entry) => seats >= entry.minSeats && (entry.maxSeats === null || seats <= entry.maxSeats),
  )
  return tier ? tier.discountPercent : 0
}

export function priceFor(plan: PlanId, period: BillingPeriod, seats = 1): number {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new RangeError(`seats must be a positive integer, got ${seats}`)
  }
  const unitCents = PLANS[plan].prices[period]
  if (unitCents === 0) return 0
  const discountPercent = groupDiscountPercentFor(seats)
  const subtotal = unitCents * seats
  return Math.round((subtotal * (100 - discountPercent)) / 100)
}

export function entitlementsFor(plan: PlanId): PlanEntitlements {
  return PLANS[plan].entitlements
}

import { describe, expect, it } from "vitest"
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  FAIR_USE_GRADED_SESSIONS_PER_MONTH,
  GROUP_DISCOUNT_TIERS,
  PLANS,
  entitlementsFor,
  priceFor,
} from "../src/plans.js"

describe("plans", () => {
  it("computes priceFor in integer USD cents with group discounts", () => {
    expect(priceFor("solo", "monthly", 1)).toBe(1000)
    expect(priceFor("solo", "yearly", 1)).toBe(7200)
    expect(priceFor("mentored", "two_month", 1)).toBe(4500)
    expect(priceFor("solo", "monthly", 5)).toBe(4250)
    expect(priceFor("mentored", "monthly", 20)).toBe(37500)
    expect(priceFor("solo", "monthly", 4)).toBe(4000)
  })

  it("returns 0 for free plan and exposes S8 packs, costs and caps", () => {
    expect(priceFor("free", "monthly", 1)).toBe(0)
    expect(PLANS.solo.prices.two_month).toBe(1500)
    expect(PLANS.mentored.prices.monthly).toBe(2500)
    expect(PLANS.mentored.prices.yearly).toBe(24000)
    expect(CREDIT_PACKS.pack_3).toEqual({ credits: 3, priceCents: 200 })
    expect(CREDIT_PACKS.pack_10).toEqual({ credits: 10, priceCents: 500 })
    expect(CREDIT_COSTS).toEqual({ sessionGrade: 1, assessment: 2 })
    expect(FAIR_USE_GRADED_SESSIONS_PER_MONTH).toBe(100)
    expect(GROUP_DISCOUNT_TIERS).toEqual([
      { minSeats: 5, maxSeats: 19, discountPercent: 15 },
      { minSeats: 20, maxSeats: null, discountPercent: 25 },
    ])
  })

  it("returns entitlements per plan", () => {
    expect(entitlementsFor("free")).toEqual({
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
    })
    expect(entitlementsFor("solo")).toEqual({
      agent: true,
      modelList: true,
      ownKeys: true,
      freeModels: true,
      teachMode: true,
      grading: true,
      notes: true,
      assessments: true,
      humanMentor: false,
      fairUseGradedSessionsPerMonth: 100,
    })
    expect(entitlementsFor("mentored")).toEqual({
      agent: true,
      modelList: true,
      ownKeys: true,
      freeModels: true,
      teachMode: true,
      grading: true,
      notes: true,
      assessments: true,
      humanMentor: true,
      fairUseGradedSessionsPerMonth: 100,
    })
  })
})

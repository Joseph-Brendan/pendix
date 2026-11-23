import { describe, expect, it } from "vitest"
import {
  DEFAULT_GRADER_MODELS,
  GRADER_RETRY_COUNT,
  GRADER_TIMEOUT_MS,
  getGraderModels,
  getGraderTierConfig,
} from "../src/models.js"

describe("models", () => {
  it("returns default grading models when env overrides are not set", () => {
    const models = getGraderModels({})
    expect(models.credit.primary).toEqual(DEFAULT_GRADER_MODELS.credit.primary)
    expect(models.credit.fallback).toEqual(DEFAULT_GRADER_MODELS.credit.fallback)
    expect(models.subscriber.primary).toEqual(DEFAULT_GRADER_MODELS.subscriber.primary)
    expect(models.subscriber.fallback).toEqual(DEFAULT_GRADER_MODELS.subscriber.fallback)
    expect(models.credit.primary.model).toBe("deepseek-flash")
    expect(models.subscriber.primary.model).toBe("gemini-4-argon")
    expect(models.subscriber.fallback.model).toBe("deepseek-v4-pro")
    expect(models.credit.retryCount).toBe(GRADER_RETRY_COUNT)
    expect(models.credit.timeoutMs).toBe(GRADER_TIMEOUT_MS)
  })

  it("returns environment overrides when set", () => {
    const env = {
      PENDIX_GRADER_CREDIT_PRIMARY: "deepseek-flash-v2",
      PENDIX_GRADER_CREDIT_FALLBACK: "gemini-3-flash",
      PENDIX_GRADER_SUBSCRIBER_PRIMARY: "gemini-5-pro",
      PENDIX_GRADER_SUBSCRIBER_FALLBACK: "deepseek-v5-pro",
    }
    const models = getGraderModels(env)
    expect(models.credit.primary.model).toBe("deepseek-flash-v2")
    expect(models.credit.fallback.model).toBe("gemini-3-flash")
    expect(models.subscriber.primary.model).toBe("gemini-5-pro")
    expect(models.subscriber.fallback.model).toBe("deepseek-v5-pro")
    expect(getGraderTierConfig("subscriber", env)).toEqual(models.subscriber)
  })

  it("ignores blank env overrides and falls back to defaults", () => {
    const models = getGraderModels({
      PENDIX_GRADER_CREDIT_PRIMARY: "   ",
      PENDIX_GRADER_SUBSCRIBER_PRIMARY: "",
    })
    expect(models.credit.primary.model).toBe(DEFAULT_GRADER_MODELS.credit.primary.model)
    expect(models.subscriber.primary.model).toBe(DEFAULT_GRADER_MODELS.subscriber.primary.model)
  })
})

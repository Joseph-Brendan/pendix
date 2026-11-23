export type GraderTier = "credit" | "subscriber"
export type GraderProvider = "google" | "deepseek"

export interface GraderModelSpec {
  readonly provider: GraderProvider
  readonly model: string
}

export interface GraderTierConfig {
  readonly primary: GraderModelSpec
  readonly fallback: GraderModelSpec
  readonly retryCount: number
  readonly timeoutMs: number
}

export type GraderModelsConfig = Readonly<Record<GraderTier, GraderTierConfig>>

export const GRADER_RETRY_COUNT = 1
export const GRADER_TIMEOUT_MS = 60_000

export const GRADER_MODEL_ENV_VARS = {
  credit: {
    primary: "PENDIX_GRADER_CREDIT_PRIMARY",
    fallback: "PENDIX_GRADER_CREDIT_FALLBACK",
  },
  subscriber: {
    primary: "PENDIX_GRADER_SUBSCRIBER_PRIMARY",
    fallback: "PENDIX_GRADER_SUBSCRIBER_FALLBACK",
  },
} as const

export const DEFAULT_GRADER_MODELS: GraderModelsConfig = {
  credit: {
    primary: { provider: "deepseek", model: "deepseek-flash" },
    fallback: { provider: "google", model: "gemini-2.5-flash" },
    retryCount: GRADER_RETRY_COUNT,
    timeoutMs: GRADER_TIMEOUT_MS,
  },
  subscriber: {
    primary: { provider: "google", model: "gemini-4-argon" },
    fallback: { provider: "deepseek", model: "deepseek-v4-pro" },
    retryCount: GRADER_RETRY_COUNT,
    timeoutMs: GRADER_TIMEOUT_MS,
  },
} as const

function inferProvider(model: string, fallback: GraderProvider): GraderProvider {
  const normalized = model.toLowerCase()
  if (normalized.includes("gemini")) return "google"
  if (normalized.includes("deepseek")) return "deepseek"
  return fallback
}

function resolveModelSpec(
  base: GraderModelSpec,
  envVar: string,
  env: Readonly<Record<string, string | undefined>>,
): GraderModelSpec {
  const override = env[envVar]?.trim()
  if (!override) return base
  return {
    provider: inferProvider(override, base.provider),
    model: override,
  }
}

export function getGraderTierConfig(
  tier: GraderTier,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GraderTierConfig {
  const defaults = DEFAULT_GRADER_MODELS[tier]
  const vars = GRADER_MODEL_ENV_VARS[tier]
  return {
    primary: resolveModelSpec(defaults.primary, vars.primary, env),
    fallback: resolveModelSpec(defaults.fallback, vars.fallback, env),
    retryCount: defaults.retryCount,
    timeoutMs: defaults.timeoutMs,
  }
}

export function getGraderModels(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GraderModelsConfig {
  return {
    credit: getGraderTierConfig("credit", env),
    subscriber: getGraderTierConfig("subscriber", env),
  }
}

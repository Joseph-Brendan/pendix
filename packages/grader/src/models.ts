import { createDeepSeek } from "@ai-sdk/deepseek"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { GraderModelSpec, GraderTierConfig } from "@pendix/shared/models"
import {
  JSONParseError,
  NoObjectGeneratedError,
  Output,
  TypeValidationError,
  generateText,
  type LanguageModel,
} from "ai"
import { ZodError, type z } from "zod"

export type GraderModelFactory = (spec: GraderModelSpec) => LanguageModel

export class GraderError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "GraderError"
    this.code = code
  }
}

export class GraderValidationError extends GraderError {
  readonly modelUsed: GraderModelSpec
  readonly validationDetails: string

  constructor(modelUsed: GraderModelSpec, validationDetails: string, options?: { cause?: unknown }) {
    super(
      "VALIDATION_FAILED",
      `Grader output failed schema validation after retry (${modelUsed.provider}/${modelUsed.model}): ${validationDetails}`,
      options,
    )
    this.name = "GraderValidationError"
    this.modelUsed = modelUsed
    this.validationDetails = validationDetails
  }
}

export class GraderModelError extends GraderError {
  readonly primarySpec: GraderModelSpec
  readonly fallbackSpec: GraderModelSpec

  constructor(
    primarySpec: GraderModelSpec,
    fallbackSpec: GraderModelSpec,
    message: string,
    options?: { cause?: unknown },
  ) {
    super("MODEL_FAILED", message, options)
    this.name = "GraderModelError"
    this.primarySpec = primarySpec
    this.fallbackSpec = fallbackSpec
  }
}

export function createDefaultModelFactory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GraderModelFactory {
  return (spec: GraderModelSpec): LanguageModel => {
    if (spec.provider === "google") {
      const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
      })
      return google(spec.model)
    }
    const deepseek = createDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY,
    })
    return deepseek(spec.model)
  }
}

export function isStructuredValidationError(error: unknown): boolean {
  if (error instanceof ZodError) return true
  if (NoObjectGeneratedError.isInstance(error)) return true
  if (TypeValidationError.isInstance(error)) return true
  if (JSONParseError.isInstance(error)) return true
  return false
}

export function formatValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "root"}: ${issue.message}`)
      .join("; ")
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    const causeDetail = error.cause ? formatValidationError(error.cause) : error.message
    return causeDetail
  }
  if (TypeValidationError.isInstance(error)) {
    return error.cause ? formatValidationError(error.cause) : error.message
  }
  if (JSONParseError.isInstance(error)) {
    return `Invalid JSON: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

async function generateWithTimeout<T>(input: {
  readonly model: LanguageModel
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly timeoutMs: number
}): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new GraderError("TIMEOUT", `Grader request timed out after ${input.timeoutMs} ms`)
      controller.abort(timeoutError)
      reject(timeoutError)
    }, input.timeoutMs)
  })

  try {
    const response = await Promise.race([
      generateText({
        model: input.model,
        system: input.system,
        prompt: input.prompt,
        output: Output.object({ schema: input.schema }),
        maxRetries: 0,
        abortSignal: controller.signal,
      }),
      timeoutPromise,
    ])
    return response.output
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function invokeModelWithValidationRetry<T>(input: {
  readonly spec: GraderModelSpec
  readonly model: LanguageModel
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly timeoutMs: number
}): Promise<T> {
  try {
    return await generateWithTimeout(input)
  } catch (error) {
    if (!isStructuredValidationError(error)) {
      throw error
    }

    const detail = formatValidationError(error)
    const retryPrompt = [
      input.prompt,
      "",
      "Your previous response failed structured output validation with this error:",
      detail,
      "Fix every validation error and return valid JSON matching the schema.",
    ].join("\n")

    try {
      return await generateWithTimeout({
        ...input,
        prompt: retryPrompt,
      })
    } catch (retryError) {
      if (isStructuredValidationError(retryError)) {
        throw new GraderValidationError(input.spec, formatValidationError(retryError), { cause: retryError })
      }
      throw retryError
    }
  }
}

async function runOnSingleSpecWithRetry<T>(input: {
  readonly spec: GraderModelSpec
  readonly modelFactory: GraderModelFactory
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly retryCount: number
  readonly timeoutMs: number
}): Promise<T> {
  const maxAttempts = 1 + Math.max(0, input.retryCount)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const model = input.modelFactory(input.spec)
      return await invokeModelWithValidationRetry({
        spec: input.spec,
        model,
        system: input.system,
        prompt: input.prompt,
        schema: input.schema,
        timeoutMs: input.timeoutMs,
      })
    } catch (error) {
      // Validation errors already performed their dedicated retry-with-error-appended; fail cleanly.
      if (error instanceof GraderValidationError) {
        throw error
      }
      lastError = error
    }
  }

  throw lastError
}

export async function runStructuredWithFallback<T>(input: {
  readonly tierConfig: GraderTierConfig
  readonly modelFactory: GraderModelFactory
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly timeoutMs?: number
}): Promise<{ readonly output: T; readonly modelUsed: GraderModelSpec }> {
  const timeoutMs = input.timeoutMs ?? input.tierConfig.timeoutMs

  try {
    const output = await runOnSingleSpecWithRetry({
      spec: input.tierConfig.primary,
      modelFactory: input.modelFactory,
      system: input.system,
      prompt: input.prompt,
      schema: input.schema,
      retryCount: input.tierConfig.retryCount,
      timeoutMs,
    })
    return { output, modelUsed: input.tierConfig.primary }
  } catch (primaryError) {
    if (primaryError instanceof GraderValidationError) {
      throw primaryError
    }

    try {
      const output = await runOnSingleSpecWithRetry({
        spec: input.tierConfig.fallback,
        modelFactory: input.modelFactory,
        system: input.system,
        prompt: input.prompt,
        schema: input.schema,
        retryCount: input.tierConfig.retryCount,
        timeoutMs,
      })
      return { output, modelUsed: input.tierConfig.fallback }
    } catch (fallbackError) {
      if (fallbackError instanceof GraderValidationError) {
        throw fallbackError
      }
      throw new GraderModelError(
        input.tierConfig.primary,
        input.tierConfig.fallback,
        `Both primary (${input.tierConfig.primary.provider}/${input.tierConfig.primary.model}) and fallback (${input.tierConfig.fallback.provider}/${input.tierConfig.fallback.model}) grader models failed.`,
        { cause: fallbackError },
      )
    }
  }
}

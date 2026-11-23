import type { ContentfulStatusCode } from "hono/utils/http-status"
import { ZodError } from "zod"

export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message)
    this.name = "AppError"
    this.status = status
    this.code = code
  }
}

export interface ErrorPayload {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export function toErrorResponse(
  error: unknown,
  nodeEnv: string,
): { readonly status: ContentfulStatusCode; readonly body: ErrorPayload } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    }
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
        },
      },
    }
  }

  const message =
    nodeEnv === "production"
      ? "Internal server error"
      : error instanceof Error && error.message
        ? error.message
        : "Internal server error"

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
  }
}

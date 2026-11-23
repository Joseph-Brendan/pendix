import { Hono, type Context } from "hono"
import type { Logger } from "pino"
import pkg from "../package.json" with { type: "json" }
import { toErrorResponse } from "./errors.js"
import { createLogger } from "./logger.js"
import { rateLimitMiddleware, type RateLimitOptions } from "./middleware/rate-limit.js"
import { requestIdMiddleware, type RequestVariables } from "./middleware/request-id.js"
import { captureException } from "./sentry.js"

export interface CreateAppOptions {
  readonly version?: string
  readonly nodeEnv?: string
  readonly logger?: Logger
  readonly rateLimit?: Omit<RateLimitOptions, "resolveUserId">
  readonly resolveUserId?: (c: Context<{ Variables: RequestVariables }>) => string | undefined
}

export function createApp(options: CreateAppOptions = {}) {
  const version = options.version ?? pkg.version
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development"
  const logger = options.logger ?? createLogger()
  const rateLimit = options.rateLimit ?? {
    ipMax: Number(process.env.RATE_LIMIT_IP_MAX ?? 100),
    ipWindowMs: Number(process.env.RATE_LIMIT_IP_WINDOW_MS ?? 60_000),
    userMax: Number(process.env.RATE_LIMIT_USER_MAX ?? 200),
    userWindowMs: Number(process.env.RATE_LIMIT_USER_WINDOW_MS ?? 60_000),
  }

  const app = new Hono<{ Variables: RequestVariables }>()

  app.use("*", requestIdMiddleware(logger))
  app.use("*", rateLimitMiddleware({ ...rateLimit, resolveUserId: options.resolveUserId }))

  app.get("/health", (c) => c.json({ ok: true, version }))

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
        },
      },
      404,
    ),
  )

  app.onError((error, c) => {
    const requestId = c.get("requestId")
    const reqLogger = c.get("logger") ?? logger.child({ requestId })
    const { status, body } = toErrorResponse(error, nodeEnv)

    if (status >= 500) {
      reqLogger.error({ err: error, status }, "unhandled error")
      captureException(error, { requestId })
    } else {
      reqLogger.warn({ status, code: body.error.code }, body.error.message)
    }

    return c.json(body, status)
  })

  return app
}

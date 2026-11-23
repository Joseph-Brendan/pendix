import crypto from "node:crypto"
import type { MiddlewareHandler } from "hono"
import type { Logger } from "pino"

export interface RequestVariables {
  requestId: string
  logger: Logger
  userId?: string
}

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/

export function requestIdMiddleware(baseLogger: Logger): MiddlewareHandler<{ Variables: RequestVariables }> {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id")?.trim()
    const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
    const reqLogger = baseLogger.child({ requestId })
    c.set("requestId", requestId)
    c.set("logger", reqLogger)
    c.header("x-request-id", requestId)

    const started = Date.now()
    await next()
    reqLogger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - started,
      },
      "request completed",
    )
  }
}

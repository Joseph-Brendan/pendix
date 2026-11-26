import { Hono, type Context } from "hono"
import type { Logger } from "pino"
import pkg from "../package.json" with { type: "json" }
import { createAuth } from "./auth.js"
import { createFlutterwaveClient, type FlutterwaveClient } from "./billing/flutterwave.js"
import type { CloudDatabase } from "./db/index.js"
import { toErrorResponse } from "./errors.js"
import { createLogger } from "./logger.js"
import { createFakeMailer, type Mailer } from "./mailer.js"
import type { AuthVariables } from "./middleware/auth.js"
import { rateLimitMiddleware, type RateLimitOptions } from "./middleware/rate-limit.js"
import { requestIdMiddleware } from "./middleware/request-id.js"
import { createAuthRoutes } from "./routes/auth.js"
import { createBillingRoutes } from "./routes/billing.js"
import { createDeviceRoutes } from "./routes/device.js"
import { createGuardianRoutes } from "./routes/guardian.js"
import { createMeRoutes } from "./routes/me.js"
import { createSessionsRoutes } from "./routes/sessions.js"
import { captureException } from "./sentry.js"

export interface CreateAppOptions {
  readonly version?: string
  readonly nodeEnv?: string
  readonly logger?: Logger
  readonly db?: CloudDatabase
  readonly mailer?: Mailer
  readonly authSecret?: string
  readonly apiUrl?: string
  readonly webUrl?: string
  readonly googleClientId?: string
  readonly googleClientSecret?: string
  readonly flwSecretKey?: string
  readonly flwWebhookHash?: string
  readonly ngnPricesJson?: string
  readonly flutterwave?: FlutterwaveClient
  readonly now?: () => number
  readonly rateLimit?: Omit<RateLimitOptions, "resolveUserId">
  readonly resolveUserId?: (c: Context<{ Variables: AuthVariables }>) => string | undefined
}

export function createApp(options: CreateAppOptions = {}) {
  const version = options.version ?? pkg.version
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development"
  const logger = options.logger ?? createLogger()
  const now = options.now ?? (() => Date.now())
  const rateLimit = options.rateLimit ?? {
    ipMax: Number(process.env.RATE_LIMIT_IP_MAX ?? 100),
    ipWindowMs: Number(process.env.RATE_LIMIT_IP_WINDOW_MS ?? 60_000),
    userMax: Number(process.env.RATE_LIMIT_USER_MAX ?? 200),
    userWindowMs: Number(process.env.RATE_LIMIT_USER_WINDOW_MS ?? 60_000),
    now,
  }

  const app = new Hono<{ Variables: AuthVariables }>()

  app.use("*", requestIdMiddleware(logger))
  app.use("*", rateLimitMiddleware({ ...rateLimit, resolveUserId: options.resolveUserId }))

  app.get("/health", (c) => c.json({ ok: true, version }))

  if (options.db) {
    const authSecret = options.authSecret || process.env.AUTH_SECRET || "dev-only-insecure-fallback-secret-32"
    const apiUrl = options.apiUrl ?? process.env.API_URL ?? "http://127.0.0.1:3001"
    const webUrl = options.webUrl ?? process.env.WEB_URL ?? "http://127.0.0.1:5173"
    const mailer = options.mailer ?? createFakeMailer()
    const auth = createAuth({
      db: options.db,
      mailer,
      secret: authSecret,
      baseUrl: apiUrl,
      googleClientId: options.googleClientId,
      googleClientSecret: options.googleClientSecret,
    })

    const flutterwave =
      options.flutterwave ??
      createFlutterwaveClient({
        secretKey: options.flwSecretKey ?? process.env.FLW_SECRET_KEY ?? "",
      })
    const flwWebhookHash = options.flwWebhookHash ?? process.env.FLW_WEBHOOK_HASH ?? ""
    const ngnPricesJson = options.ngnPricesJson ?? process.env.NGN_PRICES_JSON

    app.route("/", createAuthRoutes({ auth, db: options.db, mailer, authSecret, webUrl, now }))
    app.route("/", createDeviceRoutes({ auth, db: options.db, mailer, authSecret, apiUrl, webUrl, now }))
    app.route("/", createGuardianRoutes({ auth, db: options.db, mailer, authSecret, webUrl, now }))
    app.route("/", createMeRoutes({ auth, db: options.db, now }))
    app.route("/", createSessionsRoutes({ auth, db: options.db, now }))
    app.route(
      "/",
      createBillingRoutes({
        auth,
        db: options.db,
        flutterwave,
        flwWebhookHash,
        apiUrl,
        webUrl,
        ngnPricesJson,
        now,
      }),
    )
  }

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

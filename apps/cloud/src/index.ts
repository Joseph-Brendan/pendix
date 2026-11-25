import { createApp } from "./app.js"
import { createDatabase } from "./db/index.js"
import { loadEnv } from "./env.js"
import { createLogger } from "./logger.js"
import { createResendMailer } from "./mailer.js"
import { initSentry } from "./sentry.js"

const env = loadEnv()
const logger = createLogger({ level: env.LOG_LEVEL })
const sentryEnabled = initSentry(env.SENTRY_DSN_API, env.NODE_ENV)
const database = createDatabase(env.DATABASE_URL)
const mailer = createResendMailer({
  apiKey: env.RESEND_API_KEY,
  from: env.EMAIL_FROM,
  logger,
})

const app = createApp({
  nodeEnv: env.NODE_ENV,
  logger,
  db: database.db,
  mailer,
  authSecret: env.AUTH_SECRET,
  apiUrl: env.API_URL,
  webUrl: env.WEB_URL,
  googleClientId: env.GOOGLE_CLIENT_ID || undefined,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
  rateLimit: {
    ipMax: env.RATE_LIMIT_IP_MAX,
    ipWindowMs: env.RATE_LIMIT_IP_WINDOW_MS,
    userMax: env.RATE_LIMIT_USER_MAX,
    userWindowMs: env.RATE_LIMIT_USER_WINDOW_MS,
  },
})

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: env.PORT,
  fetch: app.fetch,
})

logger.info({ port: server.port, nodeEnv: env.NODE_ENV, sentryEnabled }, "pendix cloud API listening")

import { createDatabase } from "./db/index.js"
import { loadEnv } from "./env.js"
import { processNextGradeJob } from "./jobs/grade-worker.js"
import { createLogger } from "./logger.js"
import { createResendMailer } from "./mailer.js"

const POLL_INTERVAL_MS = 2_000

async function main() {
  const env = loadEnv()
  const logger = createLogger({ level: env.LOG_LEVEL })
  const database = createDatabase(env.DATABASE_URL)
  const mailer = createResendMailer({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    logger,
  })

  let stopped = false
  const shutdown = () => {
    stopped = true
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  logger.info("pendix grading worker started")

  while (!stopped) {
    try {
      const outcome = await processNextGradeJob({
        db: database.db,
        mailer,
        webUrl: env.WEB_URL,
        logger,
      })
      if (outcome) {
        logger.info(outcome, "processed grading job")
        continue
      }
    } catch (error) {
      logger.error({ err: error }, "grading worker loop error")
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  await database.close()
  logger.info("pendix grading worker stopped")
}

await main()

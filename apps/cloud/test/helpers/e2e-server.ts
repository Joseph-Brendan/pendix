import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createApp } from "../../src/app.js"
import { schema } from "../../src/db/schema.js"
import { createLogger } from "../../src/logger.js"
import { createFakeMailer } from "../../src/mailer.js"
import { createTestDatabase } from "./db.js"

const PORT = Number(process.env.E2E_API_PORT ?? 4301)
const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:4173"
const API_URL = `http://127.0.0.1:${PORT}`

const testDb = await createTestDatabase()
const mailer = createFakeMailer()

const cloudApp = createApp({
  version: "0.1.0-e2e",
  nodeEnv: "test",
  logger: createLogger({ level: "warn" }),
  db: testDb.db,
  mailer,
  authSecret: "e2e-test-auth-secret-32-bytes-long",
  apiUrl: API_URL,
  webUrl: WEB_URL,
  rateLimit: {
    ipMax: 1000,
    ipWindowMs: 60_000,
    userMax: 1000,
    userWindowMs: 60_000,
  },
})

const wrapper = new Hono()

wrapper.get("/__test/emails", (c) => {
  const to = c.req.query("to")?.trim().toLowerCase()
  const items = to ? mailer.sent.filter((m) => m.to.toLowerCase() === to) : mailer.sent
  return c.json({ emails: items })
})

wrapper.post("/__test/emails/clear", (c) => {
  mailer.clear()
  return c.json({ ok: true })
})

wrapper.get("/__test/user-exists", async (c) => {
  const email = c.req.query("email")?.trim().toLowerCase() ?? ""
  const rows = await testDb.db
    .select({ id: schema.users.id, email: schema.users.email, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.email, email))
  return c.json({ exists: rows.length > 0, count: rows.length, user: rows[0] ?? null })
})

wrapper.route("/", cloudApp)

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch: wrapper.fetch,
})

console.log(`e2e cloud api listening on ${API_URL}`)

async function shutdown() {
  server.stop(true)
  await testDb.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

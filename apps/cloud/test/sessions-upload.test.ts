import { eq } from "drizzle-orm"
import { Writable } from "node:stream"
import pino from "pino"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { schema } from "../src/db/schema.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  return header
    .split(/,(?=\s*[^;]+=[^;]+)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ")
}

function extractVerifyUrl(text: string): string {
  const match = /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i.exec(text)
  if (!match) throw new Error(`No verify URL found in email: ${text}`)
  return match[0]
}

async function createActiveAdultWithPlan(
  app: ReturnType<typeof createApp>,
  testDb: TestDatabase,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
  options: { readonly subscribe?: boolean; readonly grantConsent?: boolean },
) {
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: "Upload Tester",
      dob: "1995-05-10",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  const { user } = (await signup.json()) as { user: { id: string } }
  const mail = mailer.sent.find((m) => m.to === email)!
  const verifyUrl = new URL(extractVerifyUrl(mail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  const login = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  const cookie = extractCookie(login)

  if (options.subscribe) {
    await testDb.db.insert(schema.subscriptions).values({
      user_id: user.id,
      plan: "solo",
      period: "monthly",
      status: "active",
      current_period_end: new Date("2026-12-25T00:00:00Z"),
    })
  }

  if (options.grantConsent) {
    const consentRes = await app.request("/consents/grading", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ granted: true, version: "2026-01" }),
    })
    expect(consentRes.status).toBe(201)
  }

  return { userId: user.id, cookie }
}

describe("POST /sessions upload, server-side redaction, and 2 MB limit", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("runs server-side redaction when the client misses a secret, stores the cleaned record, and logs a warning with counts only", async () => {
    const logLines: string[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString("utf8"))
        cb()
      },
    })
    const logger = pino({ level: "warn" }, sink)
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger,
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => new Date("2026-11-25T10:00:00Z").getTime(),
    })

    const { cookie } = await createActiveAdultWithPlan(app, testDb, mailer, "server-redact@example.com", {
      subscribe: true,
      grantConsent: true,
    })

    // Construct synthetic secret at runtime so test source contains no literal key patterns.
    const missedKey = ["sk", "ant", "api03", "9xYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_AA"].join("-")
    const missedEmail = "missed.user@example.com"

    // Simulates client redaction disabled: raw secret reaches POST /sessions.
    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        source: "terminal",
        local_session_id: "ses_missed_secret",
        project_title: "invoice-app",
        model: "gemini-2.5-pro",
        records: [
          {
            type: "start",
            session_id: "ses_missed_secret",
            time: "2026-11-25T10:00:00.000Z",
            project_name: "invoice-app",
            provider: "google",
            model: "gemini-2.5-pro",
            teach_mode: false,
          },
          {
            type: "prompt",
            session_id: "ses_missed_secret",
            time: "2026-11-25T10:00:01.000Z",
            text: `My key is ${missedKey} and email is ${missedEmail}`,
            files: [],
          },
        ],
      }),
    })

    expect(uploadRes.status).toBe(201)
    const uploadBody = (await uploadRes.json()) as { id: string; status: string; redaction_count: number }
    expect(uploadBody.id).toBeTruthy()
    expect(uploadBody.status).toBe("queued")
    expect(uploadBody.redaction_count).toBe(2)

    const [storedSession] = await testDb.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, uploadBody.id))
    expect(storedSession?.status).toBe("queued")

    const [storedRecord] = await testDb.db
      .select()
      .from(schema.sessionRecords)
      .where(eq(schema.sessionRecords.session_id, uploadBody.id))
    const storedJson = JSON.stringify(storedRecord?.redacted_json)
    expect(storedJson).toContain("[REDACTED:anthropic_key]")
    expect(storedJson).toContain("[REDACTED:email]")
    expect(storedJson).not.toContain(missedKey)
    expect(storedJson).not.toContain(missedEmail)

    // Warning log includes the count, NEVER the secret or email.
    const combinedLogs = logLines.join("\n")
    expect(combinedLogs).toContain("server-side redaction")
    expect(combinedLogs).not.toContain(missedKey)
    expect(combinedLogs).not.toContain(missedEmail)
  })

  it("rejects session records larger than 2 MB with 413", async () => {
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: pino({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => new Date("2026-11-25T10:00:00Z").getTime(),
    })

    const { cookie } = await createActiveAdultWithPlan(app, testDb, mailer, "oversized@example.com", {
      subscribe: true,
      grantConsent: true,
    })

    const oversizedPayload = JSON.stringify({
      source: "terminal",
      project_title: "huge-app",
      records: [
        {
          type: "prompt",
          session_id: "ses_huge",
          time: "2026-11-25T10:00:00.000Z",
          text: "a".repeat(2 * 1024 * 1024 + 512),
          files: [],
        },
      ],
    })

    const res = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: oversizedPayload,
    })

    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
  })

  it("rejects uploads without grading consent or entitlement", async () => {
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: pino({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => new Date("2026-11-25T10:00:00Z").getTime(),
    })

    // Subscribed but no grading consent -> 403 GRADING_CONSENT_REQUIRED.
    const noConsent = await createActiveAdultWithPlan(app, testDb, mailer, "noconsent@example.com", {
      subscribe: true,
      grantConsent: false,
    })
    const payload = JSON.stringify({
      source: "terminal",
      records: [
        {
          type: "start",
          session_id: "ses_nc",
          time: "2026-11-25T10:00:00.000Z",
          project_name: "demo",
          provider: "google",
          model: "gemini-2.5-pro",
          teach_mode: false,
        },
      ],
    })
    const res1 = await app.request("/sessions", {
      method: "POST",
      headers: { cookie: noConsent.cookie, "content-type": "application/json" },
      body: payload,
    })
    expect(res1.status).toBe(403)
    expect(((await res1.json()) as { error: { code: string } }).error.code).toBe("GRADING_CONSENT_REQUIRED")

    // Consent granted, but free plan and 0 credits -> 403 ENTITLEMENT_REQUIRED.
    const freeUser = await createActiveAdultWithPlan(app, testDb, mailer, "freeonly@example.com", {
      subscribe: false,
      grantConsent: true,
    })
    const res2 = await app.request("/sessions", {
      method: "POST",
      headers: { cookie: freeUser.cookie, "content-type": "application/json" },
      body: payload,
    })
    expect(res2.status).toBe(403)
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe("ENTITLEMENT_REQUIRED")
  })
})

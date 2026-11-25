import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { entitlementsFor } from "@pendix/shared/plans"
import { createApp } from "../src/app.js"
import { schema } from "../src/db/schema.js"
import { createLogger } from "../src/logger.js"
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

describe("accounts, email verification, age blocking, and /me", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("adult signs up, verifies email, and GET /me shows an active adult with consents recorded", async () => {
    const mailer = createFakeMailer()
    const now = () => new Date("2026-11-25T10:00:00Z").getTime()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now,
    })

    const signupRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "adult@example.com",
        password: "Password123!",
        display_name: "Ada Adult",
        dob: "2000-05-10",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(signupRes.status).toBe(201)
    const signupBody = (await signupRes.json()) as { user: { id: string; account_kind: string; status: string } }
    expect(signupBody.user.account_kind).toBe("adult")
    expect(signupBody.user.status).toBe("pending_verification")

    const verificationEmail = mailer.sent.find((m) => m.to === "adult@example.com")
    expect(verificationEmail).toBeDefined()

    const verifyUrl = new URL(extractVerifyUrl(verificationEmail!.text))
    const verifyRes = await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)
    expect([200, 302]).toContain(verifyRes.status)

    const loginRes = await app.request("/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "adult@example.com",
        password: "Password123!",
      }),
    })
    expect(loginRes.status).toBe(200)
    const cookie = extractCookie(loginRes)
    expect(cookie).toContain("better-auth.session_token=")

    const meRes = await app.request("/me", {
      headers: { cookie },
    })
    expect(meRes.status).toBe(200)
    expect(await meRes.json()).toEqual({
      id: signupBody.user.id,
      display_name: "Ada Adult",
      email: "adult@example.com",
      account_kind: "adult",
      status: "active",
      plan: "free",
      entitlements: entitlementsFor("free"),
    })

    const consents = await testDb.db
      .select()
      .from(schema.consents)
      .where(eq(schema.consents.user_id, signupBody.user.id))
    expect(consents.map((c) => `${c.kind}:${c.version}`).sort()).toEqual(["privacy:2026-01", "terms:2026-01"])
  })

  it("under-15 gets AGE_BLOCKED and nothing is stored or emailed", async () => {
    const mailer = createFakeMailer()
    const now = () => new Date("2026-11-25T10:00:00Z").getTime()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now,
    })

    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "young@example.com",
        password: "Password123!",
        display_name: "Young Learner",
        dob: "2012-01-01",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe("AGE_BLOCKED")
    expect(body.error.message.length).toBeGreaterThan(10)

    const users = await testDb.db.select().from(schema.users).where(eq(schema.users.email, "young@example.com"))
    expect(users).toHaveLength(0)
    expect(mailer.sent).toHaveLength(0)
  })

  it("Google sign-up requires date of birth before the account works and blocks under-15 cleanly", async () => {
    const mailer = createFakeMailer()
    const now = () => new Date("2026-11-25T10:00:00Z").getTime()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now,
    })

    // Simulate a freshly created Google OAuth user awaiting DOB on the next screen.
    const [googleUser] = await testDb.db
      .insert(schema.users)
      .values({
        email: "google-kid@example.com",
        display_name: "Google Kid",
        dob: "",
        account_kind: "pending",
        status: "pending_onboarding",
        email_verified: true,
      })
      .returning()

    const sessionToken = "google-onboarding-session-token"
    await testDb.db.insert(schema.authSessions).values({
      user_id: googleUser!.id,
      token: sessionToken,
      expires_at: new Date("2026-12-01T00:00:00Z"),
    })

    const headers = {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    }

    // Cannot use protected routes before submitting DOB.
    const blockedRoute = await app.request("/sessions", { headers })
    expect(blockedRoute.status).toBe(403)
    expect(((await blockedRoute.json()) as { error: { code: string } }).error.code).toBe("ONBOARDING_REQUIRED")

    // Submitting an under-15 DOB returns AGE_BLOCKED and deletes the pending user row.
    const completeRes = await app.request("/auth/complete-signup", {
      method: "POST",
      headers,
      body: JSON.stringify({
        display_name: "Google Kid",
        dob: "2013-03-01",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(completeRes.status).toBe(403)
    expect(((await completeRes.json()) as { error: { code: string } }).error.code).toBe("AGE_BLOCKED")

    const remaining = await testDb.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "google-kid@example.com"))
    expect(remaining).toHaveLength(0)
    expect(mailer.sent).toHaveLength(0)
  })

  it("DELETE /me removes the user and all related rows after confirmation", async () => {
    const mailer = createFakeMailer()
    const now = () => new Date("2026-11-25T10:00:00Z").getTime()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now,
    })

    const signupRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "delete-me@example.com",
        password: "Password123!",
        display_name: "Delete Me",
        dob: "1995-04-04",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    const { user } = (await signupRes.json()) as { user: { id: string } }
    const email = mailer.sent.find((m) => m.to === "delete-me@example.com")!
    const verifyUrl = new URL(extractVerifyUrl(email.text))
    await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

    const loginRes = await app.request("/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "delete-me@example.com", password: "Password123!" }),
    })
    const cookie = extractCookie(loginRes)

    // Add related rows to verify cascade deletion.
    await testDb.db.insert(schema.devices).values({
      user_id: user.id,
      name: "Laptop",
      token_hash: "hash-device-delete-me",
    })
    await testDb.db.insert(schema.sessions).values({
      user_id: user.id,
      source: "terminal",
      project_title: "Demo",
      model: "gemini-4-argon",
    })

    // Reject without explicit confirmation.
    const unconfirmed = await app.request("/me", {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    })
    expect(unconfirmed.status).toBe(400)

    const deleted = await app.request("/me", {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ ok: true, deleted: true })

    expect(await testDb.db.select().from(schema.users).where(eq(schema.users.id, user.id))).toHaveLength(0)
    expect(await testDb.db.select().from(schema.consents).where(eq(schema.consents.user_id, user.id))).toHaveLength(0)
    expect(await testDb.db.select().from(schema.devices).where(eq(schema.devices.user_id, user.id))).toHaveLength(0)
    expect(await testDb.db.select().from(schema.sessions).where(eq(schema.sessions.user_id, user.id))).toHaveLength(0)
    expect(
      await testDb.db.select().from(schema.authSessions).where(eq(schema.authSessions.user_id, user.id)),
    ).toHaveLength(0)
  })
})

import { FAIR_USE_GRADED_SESSIONS_PER_MONTH } from "@pendix/shared/plans"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import {
  getCreditBalance,
  insertCreditEntry,
  markSessionGradingFailed,
} from "../src/credits.js"
import { schema } from "../src/db/schema.js"
import { getEntitlements } from "../src/entitlements.js"
import { createLogger } from "../src/logger.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"
const FIXED_NOW = new Date("2026-11-26T12:00:00.000Z").getTime()

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

function makeUploadBody(sessionId: string): string {
  return JSON.stringify({
    source: "terminal",
    local_session_id: sessionId,
    project_title: "credit-test-app",
    model: "gemini-2.5-pro",
    records: [
      {
        type: "start",
        session_id: sessionId,
        time: "2026-11-26T11:50:00.000Z",
        project_name: "credit-test-app",
        provider: "google",
        model: "gemini-2.5-pro",
        teach_mode: false,
      },
      {
        type: "prompt",
        session_id: sessionId,
        time: "2026-11-26T11:51:00.000Z",
        text: "Add unit tests for the credit ledger in apps/cloud.",
        files: ["apps/cloud/src/credits.ts"],
      },
    ],
  })
}

async function createConsentedAdult(
  app: ReturnType<typeof createApp>,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
) {
  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: "Credit Learner",
      dob: "1996-03-14",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signupRes.status).toBe(201)
  const { user } = (await signupRes.json()) as { user: { id: string } }
  const mail = mailer.sent.find((m) => m.to === email)!
  const verifyUrl = new URL(extractVerifyUrl(mail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  const loginRes = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  expect(loginRes.status).toBe(200)
  const cookie = extractCookie(loginRes)

  const consentRes = await app.request("/consents/grading", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ granted: true, version: "2026-01" }),
  })
  expect(consentRes.status).toBe(201)

  return { userId: user.id, cookie }
}

describe("credits ledger, entitlements, fair use cap, and refunds", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  function makeApp() {
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => FIXED_NOW,
    })
    return { app, mailer }
  }

  it("buys 10 credits, grades a session, reduces balance to 9, and exposes last 50 rows on GET /me/credits", async () => {
    const { app, mailer } = makeApp()
    const { userId, cookie } = await createConsentedAdult(app, mailer, "buy10@example.com")

    await insertCreditEntry(testDb.db, {
      userId,
      amount: 10,
      reason: "purchase",
      referenceId: "pay_pack_10",
      createdAt: new Date(FIXED_NOW - 60_000),
    })

    const entBefore = await getEntitlements(testDb.db, userId, new Date(FIXED_NOW))
    expect(entBefore).toMatchObject({
      plan: "free",
      source: "personal",
      period_end: null,
      graded_sessions_this_month: 0,
      fair_use_remaining: 0,
      credit_balance: 10,
      can_grade: true,
      can_assess: true,
      has_mentor: false,
      teach_lock: "none",
    })

    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeUploadBody("ses_buy10_1"),
    })
    expect(uploadRes.status).toBe(201)
    const uploadBody = (await uploadRes.json()) as { id: string; tier: string }
    expect(uploadBody.tier).toBe("credit")

    const balanceAfter = await getCreditBalance(testDb.db, userId)
    expect(balanceAfter).toBe(9)

    const creditsRes = await app.request("/me/credits", { headers: { cookie } })
    expect(creditsRes.status).toBe(200)
    const creditsBody = (await creditsRes.json()) as {
      balance: number
      ledger: Array<{ amount: number; reason: string; reference_id: string | null }>
    }
    expect(creditsBody.balance).toBe(9)
    expect(creditsBody.ledger).toHaveLength(2)
    expect(creditsBody.ledger[0]).toMatchObject({
      amount: -1,
      reason: "session_grade",
      reference_id: uploadBody.id,
    })
    expect(creditsBody.ledger[1]).toMatchObject({
      amount: 10,
      reason: "purchase",
      reference_id: "pay_pack_10",
    })
  })

  it("allows exactly one of two concurrent uploads when credit balance is 1, rejecting the other with NO_CREDITS", async () => {
    const { app, mailer } = makeApp()
    const { userId, cookie } = await createConsentedAdult(app, mailer, "race1@example.com")

    await insertCreditEntry(testDb.db, {
      userId,
      amount: 1,
      reason: "admin_grant",
      referenceId: "grant_race",
    })

    const [resA, resB] = await Promise.all([
      app.request("/sessions", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: makeUploadBody("ses_race_a"),
      }),
      app.request("/sessions", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: makeUploadBody("ses_race_b"),
      }),
    ])

    const statuses = [resA.status, resB.status].sort((a, b) => a - b)
    expect(statuses).toEqual([201, 403])

    const failedRes = resA.status === 403 ? resA : resB
    const failedBody = (await failedRes.json()) as { error: { code: string } }
    expect(failedBody.error.code).toBe("NO_CREDITS")

    const finalBalance = await getCreditBalance(testDb.db, userId)
    expect(finalBalance).toBe(0)
  })

  it("subscriber at 100 sessions this month uses a credit when available, and gets FAIR_USE_REACHED with 0 credits", async () => {
    const { app, mailer } = makeApp()
    const { userId, cookie } = await createConsentedAdult(app, mailer, "fairuse@example.com")

    await testDb.db.insert(schema.subscriptions).values({
      user_id: userId,
      plan: "solo",
      period: "monthly",
      status: "active",
      current_period_end: new Date("2026-12-26T00:00:00.000Z"),
    })

    // Seed 100 graded sessions in the current month (November 2026).
    const existingSessions = Array.from({ length: FAIR_USE_GRADED_SESSIONS_PER_MONTH }, (_, i) => ({
      user_id: userId,
      source: "terminal",
      project_title: `proj-${i}`,
      model: "gemini-2.5-pro",
      status: "graded",
      tier: "subscriber",
      graded_at: new Date("2026-11-10T10:00:00.000Z"),
      created_at: new Date("2026-11-10T10:00:00.000Z"),
    }))
    await testDb.db.insert(schema.sessions).values(existingSessions)

    // With 0 credits at 100/100 -> FAIR_USE_REACHED.
    const entAtCapNoCredits = await getEntitlements(testDb.db, userId, new Date(FIXED_NOW))
    expect(entAtCapNoCredits).toMatchObject({
      plan: "solo",
      source: "personal",
      graded_sessions_this_month: 100,
      fair_use_remaining: 0,
      credit_balance: 0,
      can_grade: false,
      has_mentor: false,
    })

    const blockedRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeUploadBody("ses_over_cap_blocked"),
    })
    expect(blockedRes.status).toBe(403)
    expect(((await blockedRes.json()) as { error: { code: string } }).error.code).toBe("FAIR_USE_REACHED")

    // Grant 3 credits: next upload succeeds and charges 1 credit (balance -> 2).
    await insertCreditEntry(testDb.db, {
      userId,
      amount: 3,
      reason: "purchase",
      referenceId: "pay_pack_3",
    })

    const entWithCredits = await getEntitlements(testDb.db, userId, new Date(FIXED_NOW))
    expect(entWithCredits.can_grade).toBe(true)
    expect(entWithCredits.credit_balance).toBe(3)

    const allowedRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeUploadBody("ses_over_cap_credit"),
    })
    expect(allowedRes.status).toBe(201)
    const allowedBody = (await allowedRes.json()) as { id: string; tier: string }
    expect(allowedBody.tier).toBe("credit")
    expect(await getCreditBalance(testDb.db, userId)).toBe(2)
  })

  it("refunds the credit automatically when grading fails permanently and is idempotent", async () => {
    const { app, mailer } = makeApp()
    const { userId, cookie } = await createConsentedAdult(app, mailer, "refund@example.com")

    await insertCreditEntry(testDb.db, {
      userId,
      amount: 2,
      reason: "purchase",
      referenceId: "pay_refund_test",
    })

    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeUploadBody("ses_will_fail"),
    })
    expect(uploadRes.status).toBe(201)
    const { id: sessionId } = (await uploadRes.json()) as { id: string }
    expect(await getCreditBalance(testDb.db, userId)).toBe(1)

    // Permanent failure refunds 1 credit and marks session failed.
    const firstRefund = await markSessionGradingFailed(testDb.db, sessionId, new Date(FIXED_NOW + 5000))
    expect(firstRefund.refunded).toBe(true)
    expect(await getCreditBalance(testDb.db, userId)).toBe(2)

    const [sessionRow] = await testDb.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
    expect(sessionRow?.status).toBe("failed")

    // Calling again does not double-refund.
    const secondRefund = await markSessionGradingFailed(testDb.db, sessionId, new Date(FIXED_NOW + 6000))
    expect(secondRefund.refunded).toBe(false)
    expect(await getCreditBalance(testDb.db, userId)).toBe(2)
  })

  it("never executes any UPDATE statement against credit_ledger", () => {
    expect(testDb.queries.length).toBeGreaterThan(0)
    const creditInserts = testDb.queries.filter(
      (q) => /\binsert\s+into\b/i.test(q) && /credit_ledger/i.test(q),
    )
    expect(creditInserts.length).toBeGreaterThan(0)

    const creditUpdates = testDb.queries.filter(
      (q) => /\bupdate\b/i.test(q) && /credit_ledger/i.test(q),
    )
    expect(creditUpdates).toEqual([])
  })
})

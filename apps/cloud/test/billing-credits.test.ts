import { CREDIT_PACKS } from "@pendix/shared/plans"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { createFakeFlutterwaveClient } from "../src/billing/flutterwave.js"
import { getCreditBalance } from "../src/credits.js"
import { schema } from "../src/db/schema.js"
import { createLogger } from "../src/logger.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"
const WEBHOOK_HASH = "test-flw-webhook-secret-hash-12345"
const FIXED_NOW = new Date("2026-11-26T15:00:00.000Z").getTime()

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

async function createSignedInAdult(
  app: ReturnType<typeof createApp>,
  testDb: TestDatabase,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
  options: { readonly displayName?: string; readonly country?: string } = {},
) {
  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: options.displayName ?? "Billing Adult",
      dob: "1994-06-12",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signupRes.status).toBe(201)
  const { user } = (await signupRes.json()) as { user: { id: string } }
  const mail = mailer.sent.find((m) => m.to === email)!
  const verifyUrl = new URL(extractVerifyUrl(mail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  if (options.country) {
    await testDb.db
      .update(schema.users)
      .set({ country: options.country })
      .where(eq(schema.users.id, user.id))
  }

  const loginRes = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  expect(loginRes.status).toBe(200)
  return { userId: user.id, cookie: extractCookie(loginRes) }
}

async function createActiveTeenWithGuardian(
  app: ReturnType<typeof createApp>,
  testDb: TestDatabase,
  mailer: ReturnType<typeof createFakeMailer>,
  teenEmail: string,
  guardianEmail: string,
) {
  const guardian = await createSignedInAdult(app, testDb, mailer, guardianEmail, {
    displayName: "Mum Guardian",
  })

  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: teenEmail,
      password: "Password123!",
      display_name: "Tolu Teen",
      dob: "2010-04-01",
      guardian_email: guardianEmail,
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signupRes.status).toBe(201)
  const { user: teen } = (await signupRes.json()) as { user: { id: string } }

  // Verify teen email and approve guardian directly for clean test setup.
  const verifyMail = mailer.sent.find((m) => m.to === teenEmail)!
  const verifyUrl = new URL(extractVerifyUrl(verifyMail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  await testDb.db
    .update(schema.guardians)
    .set({ guardian_user_id: guardian.userId, approved_at: new Date(FIXED_NOW - 10_000) })
    .where(eq(schema.guardians.teen_user_id, teen.id))

  await testDb.db
    .update(schema.users)
    .set({ status: "active" })
    .where(eq(schema.users.id, teen.id))

  const teenLogin = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: teenEmail, password: "Password123!" }),
  })
  expect(teenLogin.status).toBe(200)

  return {
    teenId: teen.id,
    teenCookie: extractCookie(teenLogin),
    guardianId: guardian.userId,
    guardianCookie: guardian.cookie,
  }
}

describe("Flutterwave one-off credit pack billing", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("creates checkout, settles on valid webhook once, and ignores duplicate webhook delivery", async () => {
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "https://app.pendix.dev",
      flwWebhookHash: WEBHOOK_HASH,
      flutterwave: flw,
      now: () => FIXED_NOW,
    })

    const { userId, cookie } = await createSignedInAdult(app, testDb, mailer, "buyer1@example.com")

    const checkoutRes = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "10" }),
    })
    expect(checkoutRes.status).toBe(201)
    const checkout = (await checkoutRes.json()) as {
      payment_id: string
      tx_ref: string
      link: string
      amount_cents: number
      currency: string
      credits: number
    }
    expect(checkout.amount_cents).toBe(CREDIT_PACKS.pack_10.priceCents)
    expect(checkout.currency).toBe("USD")
    expect(checkout.credits).toBe(10)
    expect(checkout.link).toContain("https://checkout.flutterwave.com")

    // Record Flutterwave's verified response for transaction 900101.
    flw.recordTransaction({
      id: "900101",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-MOCK-900101",
      amount: 5, // $5.00 USD
      currency: "USD",
      status: "successful",
    })

    const webhookBody = JSON.stringify({
      event: "charge.completed",
      data: {
        id: 900101,
        tx_ref: checkout.tx_ref,
        amount: 999999, // Untrusted body amount; server must use verified amount!
        currency: "USD",
        status: "successful",
      },
    })

    const wh1 = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": WEBHOOK_HASH,
      },
      body: webhookBody,
    })
    expect(wh1.status).toBe(200)
    expect(await getCreditBalance(testDb.db, userId)).toBe(10)

    const [paidRow] = await testDb.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, checkout.payment_id))
    expect(paidRow?.status).toBe("paid")
    expect(paidRow?.flutterwave_tx_id).toBe("900101")

    // Repeated webhook changes nothing.
    const wh2 = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": WEBHOOK_HASH,
      },
      body: webhookBody,
    })
    expect(wh2.status).toBe(200)
    expect(await getCreditBalance(testDb.db, userId)).toBe(10)
  })

  it("rejects webhooks with a bad signature with 401 and changes nothing", async () => {
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      flwWebhookHash: WEBHOOK_HASH,
      flutterwave: flw,
      now: () => FIXED_NOW,
    })

    const { userId, cookie } = await createSignedInAdult(app, testDb, mailer, "badsig@example.com")
    const checkoutRes = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "3" }),
    })
    const checkout = (await checkoutRes.json()) as { payment_id: string; tx_ref: string }

    flw.recordTransaction({
      id: "900102",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-MOCK-900102",
      amount: 2,
      currency: "USD",
      status: "successful",
    })

    const badRes = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": "wrong-signature",
      },
      body: JSON.stringify({
        event: "charge.completed",
        data: { id: 900102, tx_ref: checkout.tx_ref, amount: 2, currency: "USD", status: "successful" },
      }),
    })
    expect(badRes.status).toBe(401)
    expect(await getCreditBalance(testDb.db, userId)).toBe(0)

    const [row] = await testDb.db.select().from(schema.payments).where(eq(schema.payments.id, checkout.payment_id))
    expect(row?.status).toBe("pending")
  })

  it("flags the payment and adds no credits when the verified amount differs from expected", async () => {
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      flwWebhookHash: WEBHOOK_HASH,
      flutterwave: flw,
      now: () => FIXED_NOW,
    })

    const { userId, cookie } = await createSignedInAdult(app, testDb, mailer, "mismatch@example.com")
    const checkoutRes = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "10" }),
    })
    const checkout = (await checkoutRes.json()) as { payment_id: string; tx_ref: string }

    // Paid $1.00 instead of $5.00.
    flw.recordTransaction({
      id: "900103",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-MOCK-900103",
      amount: 1,
      currency: "USD",
      status: "successful",
    })

    const whRes = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": WEBHOOK_HASH,
      },
      body: JSON.stringify({
        event: "charge.completed",
        data: { id: 900103, tx_ref: checkout.tx_ref, amount: 5, currency: "USD", status: "successful" },
      }),
    })
    expect(whRes.status).toBe(200)
    expect(await getCreditBalance(testDb.db, userId)).toBe(0)

    const [row] = await testDb.db.select().from(schema.payments).where(eq(schema.payments.id, checkout.payment_id))
    expect(row?.status).toBe("flagged")
    expect(row?.flag_reason).toContain("amount")
  })

  it("credits once when redirect verification arrives before the webhook", async () => {
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      flwWebhookHash: WEBHOOK_HASH,
      ngnPricesJson: JSON.stringify({ pack_3: 300_000, pack_10: 750_000 }),
      flutterwave: flw,
      now: () => FIXED_NOW,
    })

    // Nigerian user gets NGN price from NGN_PRICES_JSON.
    const { userId, cookie } = await createSignedInAdult(app, testDb, mailer, "ng-buyer@example.com", {
      country: "NG",
    })

    const checkoutRes = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "3" }),
    })
    expect(checkoutRes.status).toBe(201)
    const checkout = (await checkoutRes.json()) as {
      payment_id: string
      tx_ref: string
      amount_cents: number
      currency: string
    }
    expect(checkout.currency).toBe("NGN")
    expect(checkout.amount_cents).toBe(300_000)

    flw.recordTransaction({
      id: "900104",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-MOCK-900104",
      amount: 3000, // 3,000 NGN = 300,000 kobo
      currency: "NGN",
      status: "successful",
    })

    // Redirect hits first.
    const redirectRes = await app.request(
      `/billing/redirect?status=successful&tx_ref=${encodeURIComponent(checkout.tx_ref)}&transaction_id=900104`,
    )
    expect(redirectRes.status).toBe(302)
    expect(redirectRes.headers.get("location")).toContain("https://app.pendix.dev/billing")
    expect(redirectRes.headers.get("location")).toContain("status=paid")
    expect(await getCreditBalance(testDb.db, userId)).toBe(3)

    // Late webhook arrives afterwards: still only 3 credits.
    const whRes = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": WEBHOOK_HASH,
      },
      body: JSON.stringify({
        event: "charge.completed",
        data: { id: 900104, tx_ref: checkout.tx_ref, amount: 3000, currency: "NGN", status: "successful" },
      }),
    })
    expect(whRes.status).toBe(200)
    expect(await getCreditBalance(testDb.db, userId)).toBe(3)
  })

  it("rejects teen checkout without a guardian session and allows linked guardian to buy credits for the teen", async () => {
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      flwWebhookHash: WEBHOOK_HASH,
      flutterwave: flw,
      now: () => FIXED_NOW,
    })

    const { teenId, teenCookie, guardianCookie } = await createActiveTeenWithGuardian(
      app,
      testDb,
      mailer,
      "tolu-billing@example.com",
      "mum-billing@example.com",
    )

    // Teen trying to pay directly is rejected.
    const teenAttempt = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie: teenCookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "3" }),
    })
    expect(teenAttempt.status).toBe(403)
    expect(((await teenAttempt.json()) as { error: { code: string } }).error.code).toBe("TEEN_GUARDIAN_REQUIRED")

    // Linked guardian creates checkout for the teen, and settled credits go to the teen's ledger.
    const guardianCheckoutRes = await app.request("/billing/credits/checkout", {
      method: "POST",
      headers: { cookie: guardianCookie, "content-type": "application/json" },
      body: JSON.stringify({ pack: "3", teen_user_id: teenId }),
    })
    expect(guardianCheckoutRes.status).toBe(201)
    const checkout = (await guardianCheckoutRes.json()) as { tx_ref: string }

    flw.recordTransaction({
      id: "900105",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-MOCK-900105",
      amount: 2,
      currency: "USD",
      status: "successful",
    })

    const whRes = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "verif-hash": WEBHOOK_HASH,
      },
      body: JSON.stringify({
        event: "charge.completed",
        data: { id: 900105, tx_ref: checkout.tx_ref, amount: 2, currency: "USD", status: "successful" },
      }),
    })
    expect(whRes.status).toBe(200)
    expect(await getCreditBalance(testDb.db, teenId)).toBe(3)
  })
})

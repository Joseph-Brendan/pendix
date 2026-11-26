import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { createFakeFlutterwaveClient } from "../src/billing/flutterwave.js"
import { syncFlutterwavePlans } from "../src/billing/plans-sync.js"
import { expireGraceSubscriptions, processNextRenewalReminderJob } from "../src/billing/subscriptions.js"
import { schema } from "../src/db/schema.js"
import { getEntitlements } from "../src/entitlements.js"
import { createLogger } from "../src/logger.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"
const WEBHOOK_HASH = "test-flw-webhook-secret-hash-sub-123"
const DAY_MS = 24 * 60 * 60 * 1000

const TEST_NGN_PRICES = JSON.stringify({
  pack_3: 300_000,
  pack_10: 750_000,
  solo_monthly: 1_500_000,
  solo_two_month: 2_250_000,
  solo_yearly: 10_800_000,
  mentored_monthly: 3_750_000,
  mentored_two_month: 6_750_000,
  mentored_yearly: 36_000_000,
})

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

async function createUser(
  app: ReturnType<typeof createApp>,
  testDb: TestDatabase,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
  options: { readonly role?: "learner" | "admin" | "mentor"; readonly displayName?: string } = {},
) {
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: options.displayName ?? "Sub Learner",
      dob: "1995-05-10",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signup.status).toBe(201)
  const { user } = (await signup.json()) as { user: { id: string } }
  const mail = mailer.sent.find((m) => m.to === email)!
  const verifyUrl = new URL(extractVerifyUrl(mail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  if (options.role && options.role !== "learner") {
    await testDb.db.update(schema.users).set({ role: options.role }).where(eq(schema.users.id, user.id))
  }

  const login = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  expect(login.status).toBe(200)
  mailer.clear()
  return { userId: user.id, cookie: extractCookie(login) }
}

describe("Flutterwave subscriptions, upgrades, groups, and refunds", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("plan sync script is idempotent across repeated runs with no duplicates", async () => {
    const flw = createFakeFlutterwaveClient()

    const first = await syncFlutterwavePlans({
      db: testDb.db,
      flutterwave: flw,
      ngnPricesJson: TEST_NGN_PRICES,
    })
    expect(first.created).toBe(8)
    expect(first.plans).toHaveLength(8)

    const second = await syncFlutterwavePlans({
      db: testDb.db,
      flutterwave: flw,
      ngnPricesJson: TEST_NGN_PRICES,
    })
    expect(second.created).toBe(0)
    expect(second.plans).toHaveLength(8)

    const rows = await testDb.db.select().from(schema.billingPlans)
    expect(rows).toHaveLength(8)
  })

  it("subscribes, verifies entitlements, renews, handles failed renewal grace -> free, and cancels until period_end", async () => {
    let clock = new Date("2026-11-01T10:00:00.000Z").getTime()
    const flw = createFakeFlutterwaveClient()
    const mailer = createFakeMailer()

    await syncFlutterwavePlans({
      db: testDb.db,
      flutterwave: flw,
      ngnPricesJson: TEST_NGN_PRICES,
    })

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
      now: () => clock,
    })

    const { userId, cookie } = await createUser(app, testDb, mailer, "sub-lifecycle@example.com")

    // 1. Subscribe to solo monthly.
    const subRes = await app.request("/billing/subscribe", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ plan: "solo", period: "monthly" }),
    })
    expect(subRes.status).toBe(201)
    const subCheckout = (await subRes.json()) as { tx_ref: string; amount_cents: number; payment_plan: string }
    expect(subCheckout.amount_cents).toBe(1000)
    expect(subCheckout.payment_plan).toBeTruthy()

    flw.recordSubscription({
      id: "flw_sub_1001",
      plan: subCheckout.payment_plan,
      status: "active",
      customer_email: "sub-lifecycle@example.com",
      amount_cents: 1000,
    })
    flw.recordTransaction({
      id: "tx_sub_1",
      tx_ref: subCheckout.tx_ref,
      flw_ref: "FLW-SUB-1",
      amount: 10,
      currency: "USD",
      status: "successful",
    })

    const whInit = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({
        event: "charge.completed",
        data: { id: "tx_sub_1", tx_ref: subCheckout.tx_ref, status: "successful" },
      }),
    })
    expect(whInit.status).toBe(200)

    const entAfterSub = await getEntitlements(testDb.db, userId, new Date(clock))
    expect(entAfterSub.plan).toBe("solo")
    expect(entAfterSub.can_grade).toBe(true)
    const initialPeriodEnd = new Date(entAfterSub.period_end!).getTime()

    // 2. Renewal webhook extends period_end by 30 days.
    clock += 30 * DAY_MS
    flw.recordTransaction({
      id: "tx_sub_renew_1",
      tx_ref: "flw_renew_tx_1",
      flw_ref: "FLW-RENEW-1",
      amount: 10,
      currency: "USD",
      status: "successful",
      customer_email: "sub-lifecycle@example.com",
      payment_plan: subCheckout.payment_plan,
    })
    const whRenew = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({
        event: "charge.completed",
        data: {
          id: "tx_sub_renew_1",
          tx_ref: "flw_renew_tx_1",
          status: "successful",
          customer: { email: "sub-lifecycle@example.com" },
          payment_plan: subCheckout.payment_plan,
        },
      }),
    })
    expect(whRenew.status).toBe(200)

    const entAfterRenew = await getEntitlements(testDb.db, userId, new Date(clock))
    expect(entAfterRenew.plan).toBe("solo")
    expect(new Date(entAfterRenew.period_end!).getTime()).toBe(initialPeriodEnd + 30 * DAY_MS)

    // 3. Cancel keeps access until period_end and cancels on Flutterwave.
    const cancelRes = await app.request("/billing/cancel", {
      method: "POST",
      headers: { cookie },
    })
    expect(cancelRes.status).toBe(200)
    expect(flw.cancelledSubscriptionIds).toContain("flw_sub_1001")

    // Still solo before period_end.
    const entBeforeEnd = await getEntitlements(testDb.db, userId, new Date(clock + 10 * DAY_MS))
    expect(entBeforeEnd.plan).toBe("solo")

    // 4. Failed renewal starts 3-day grace, then after grace user is free and receives an email.
    clock = new Date(entAfterRenew.period_end!).getTime() + 1000
    flw.recordTransaction({
      id: "tx_sub_fail_1",
      tx_ref: "flw_fail_tx_1",
      flw_ref: "FLW-FAIL-1",
      amount: 10,
      currency: "USD",
      status: "failed",
      customer_email: "sub-lifecycle@example.com",
      payment_plan: subCheckout.payment_plan,
    })
    const whFail = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({
        event: "charge.completed",
        data: {
          id: "tx_sub_fail_1",
          tx_ref: "flw_fail_tx_1",
          status: "failed",
          customer: { email: "sub-lifecycle@example.com" },
          payment_plan: subCheckout.payment_plan,
        },
      }),
    })
    expect(whFail.status).toBe(200)

    // During 3-day grace, user still has solo access.
    const entInGrace = await getEntitlements(testDb.db, userId, new Date(clock + 2 * DAY_MS))
    expect(entInGrace.plan).toBe("solo")

    // After 3-day grace expires -> free + email sent.
    clock += 4 * DAY_MS
    const expiredCount = await expireGraceSubscriptions(testDb.db, mailer, new Date(clock))
    expect(expiredCount).toBe(1)

    const entAfterGrace = await getEntitlements(testDb.db, userId, new Date(clock))
    expect(entAfterGrace.plan).toBe("free")
    expect(mailer.sent.some((m) => m.to === "sub-lifecycle@example.com")).toBe(true)
  })

  it("two-month purchase gives 60 days and schedules a renewal reminder 5 days before period_end", async () => {
    const startMs = new Date("2026-11-01T12:00:00.000Z").getTime()
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
      now: () => startMs,
    })

    const { userId, cookie } = await createUser(app, testDb, mailer, "twomonth@example.com")

    const res = await app.request("/billing/subscribe", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ plan: "solo", period: "two_month" }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { tx_ref: string; amount_cents: number }
    expect(body.amount_cents).toBe(1500)

    flw.recordTransaction({
      id: "tx_2m_1",
      tx_ref: body.tx_ref,
      flw_ref: "FLW-2M-1",
      amount: 15,
      currency: "USD",
      status: "successful",
    })

    const wh = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({ event: "charge.completed", data: { id: "tx_2m_1", tx_ref: body.tx_ref } }),
    })
    expect(wh.status).toBe(200)

    const ent = await getEntitlements(testDb.db, userId, new Date(startMs))
    expect(ent.plan).toBe("solo")
    const expectedEnd = startMs + 60 * DAY_MS
    expect(new Date(ent.period_end!).getTime()).toBe(expectedEnd)

    // Reminder is scheduled at day 55 (5 days before end).
    const reminderJobs = await testDb.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.kind, "renewal_reminder"))
    const userJob = reminderJobs.find((j) => (j.payload as { user_id?: string }).user_id === userId)
    expect(userJob).toBeDefined()
    expect(userJob!.run_at.getTime()).toBe(expectedEnd - 5 * DAY_MS)

    const sent = await processNextRenewalReminderJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => expectedEnd - 5 * DAY_MS + 1000,
    })
    expect(sent?.sent).toBe(true)
    expect(mailer.sent.some((m) => m.to === "twomonth@example.com")).toBe(true)
  })

  it("upgrades solo monthly to mentored monthly with 15 of 30 days left for 750 cents", async () => {
    const startMs = new Date("2026-11-01T00:00:00.000Z").getTime()
    let clock = startMs + 15 * DAY_MS // Exactly 15 of 30 days remaining
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
      now: () => clock,
    })

    const { userId, cookie } = await createUser(app, testDb, mailer, "upgrade15@example.com")

    await testDb.db.insert(schema.subscriptions).values({
      user_id: userId,
      plan: "solo",
      period: "monthly",
      status: "active",
      current_period_start: new Date(startMs),
      current_period_end: new Date(startMs + 30 * DAY_MS),
    })

    const upgradeRes = await app.request("/billing/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ to_plan: "mentored" }),
    })
    expect(upgradeRes.status).toBe(201)
    const upgrade = (await upgradeRes.json()) as { tx_ref: string; amount_cents: number }
    expect(upgrade.amount_cents).toBe(750)

    flw.recordTransaction({
      id: "tx_upg_750",
      tx_ref: upgrade.tx_ref,
      flw_ref: "FLW-UPG-750",
      amount: 7.5,
      currency: "USD",
      status: "successful",
    })

    const wh = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({ event: "charge.completed", data: { id: "tx_upg_750", tx_ref: upgrade.tx_ref } }),
    })
    expect(wh.status).toBe(200)

    const ent = await getEntitlements(testDb.db, userId, new Date(clock))
    expect(ent.plan).toBe("mentored")
    expect(ent.has_mentor).toBe(true)
  })

  it("charges 4250 cents for 5 solo monthly group seats, creates a 5-seat group, supports prorated add seats and period-end seat removal", async () => {
    let clock = new Date("2026-11-01T00:00:00.000Z").getTime()
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
      now: () => clock,
    })

    const owner = await createUser(app, testDb, mailer, "group-owner@example.com")
    const member = await createUser(app, testDb, mailer, "group-member@example.com")

    const checkoutRes = await app.request("/billing/groups/checkout", {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Lagos Cohort", plan: "solo", period: "monthly", seats: 5 }),
    })
    expect(checkoutRes.status).toBe(201)
    const checkout = (await checkoutRes.json()) as { tx_ref: string; amount_cents: number }
    expect(checkout.amount_cents).toBe(4250)

    flw.recordTransaction({
      id: "tx_grp_5",
      tx_ref: checkout.tx_ref,
      flw_ref: "FLW-GRP-5",
      amount: 42.5,
      currency: "USD",
      status: "successful",
    })

    const wh = await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({ event: "charge.completed", data: { id: "tx_grp_5", tx_ref: checkout.tx_ref } }),
    })
    expect(wh.status).toBe(200)

    const [group] = await testDb.db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.owner_user_id, owner.userId))
    expect(group).toBeDefined()
    expect(group!.seat_count).toBe(5)

    // Assign a member a solo seat, then remove it -> member keeps access until period_end, then loses it.
    await testDb.db.insert(schema.groupMembers).values({
      group_id: group!.id,
      user_id: member.userId,
      role: "member",
      seat_plan: "solo",
    })

    // Mid-period (15 of 30 days left): add 2 more seats -> prorated payment.
    clock += 15 * DAY_MS
    const addRes = await app.request(`/billing/groups/${group!.id}/seats/add`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ seats: 2 }),
    })
    expect(addRes.status).toBe(201)
    const addCheckout = (await addRes.json()) as { tx_ref: string; amount_cents: number }
    // 2 seats at 850 cents each (15% group discount on 7 seats) * 15/30 = 850 cents.
    expect(addCheckout.amount_cents).toBe(850)

    flw.recordTransaction({
      id: "tx_grp_add2",
      tx_ref: addCheckout.tx_ref,
      flw_ref: "FLW-GRP-ADD2",
      amount: 8.5,
      currency: "USD",
      status: "successful",
    })
    await app.request("/webhooks/flutterwave", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": WEBHOOK_HASH },
      body: JSON.stringify({ event: "charge.completed", data: { id: "tx_grp_add2", tx_ref: addCheckout.tx_ref } }),
    })

    const [groupAfterAdd] = await testDb.db.select().from(schema.groups).where(eq(schema.groups.id, group!.id))
    expect(groupAfterAdd!.seat_count).toBe(7)

    // Remove member seat: active until period end, free after period end.
    const removeRes = await app.request(`/billing/groups/${group!.id}/seats/remove`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ member_user_id: member.userId }),
    })
    expect(removeRes.status).toBe(200)

    expect((await getEntitlements(testDb.db, member.userId, new Date(clock + 5 * DAY_MS))).plan).toBe("solo")
    expect((await getEntitlements(testDb.db, member.userId, new Date(clock + 16 * DAY_MS))).plan).toBe("free")
  })

  it("allows admin refund within 7 days of first payment, ends plan, flags mentor earnings, and rejects after 7 days", async () => {
    const paidAt = new Date("2026-11-01T10:00:00.000Z").getTime()
    let clock = paidAt + 3 * DAY_MS
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
      now: () => clock,
    })

    const admin = await createUser(app, testDb, mailer, "admin-ref@example.com", { role: "admin" })
    const mentor = await createUser(app, testDb, mailer, "mentor-ref@example.com", { role: "mentor" })
    const learner = await createUser(app, testDb, mailer, "learner-ref@example.com")
    const lateLearner = await createUser(app, testDb, mailer, "late-ref@example.com")

    const [payment] = await testDb.db
      .insert(schema.payments)
      .values({
        user_id: learner.userId,
        payer_user_id: learner.userId,
        kind: "subscription",
        tx_ref: "pdx_ref_within_7d",
        flutterwave_tx_id: "flw_tx_ref_1",
        amount_cents: 2500,
        currency: "USD",
        status: "paid",
        paid_at: new Date(paidAt),
      })
      .returning()

    await testDb.db.insert(schema.subscriptions).values({
      user_id: learner.userId,
      plan: "mentored",
      period: "monthly",
      status: "active",
      current_period_start: new Date(paidAt),
      current_period_end: new Date(paidAt + 30 * DAY_MS),
    })

    const [matchRow] = await testDb.db
      .insert(schema.matches)
      .values({
        learner_user_id: learner.userId,
        mentor_user_id: mentor.userId,
        status: "active",
      })
      .returning()

    // Non-admin is forbidden.
    const nonAdminRes = await app.request(`/admin/refunds/${payment!.id}`, {
      method: "POST",
      headers: { cookie: learner.cookie },
    })
    expect(nonAdminRes.status).toBe(403)

    // Admin refunds within 7 days -> succeeds, ends plan, flags match earnings.
    const refundRes = await app.request(`/admin/refunds/${payment!.id}`, {
      method: "POST",
      headers: { cookie: admin.cookie },
    })
    expect(refundRes.status).toBe(200)
    expect(flw.refundedTransactionIds).toContain("flw_tx_ref_1")

    const [paymentAfter] = await testDb.db.select().from(schema.payments).where(eq(schema.payments.id, payment!.id))
    expect(paymentAfter?.status).toBe("refunded")

    const entAfterRefund = await getEntitlements(testDb.db, learner.userId, new Date(clock))
    expect(entAfterRefund.plan).toBe("free")

    const [matchAfter] = await testDb.db.select().from(schema.matches).where(eq(schema.matches.id, matchRow!.id))
    expect(matchAfter?.refund_flagged_at).toBeTruthy()

    // After 7 days -> rejected with 400 REFUND_WINDOW_EXPIRED.
    const [latePayment] = await testDb.db
      .insert(schema.payments)
      .values({
        user_id: lateLearner.userId,
        payer_user_id: lateLearner.userId,
        kind: "subscription",
        tx_ref: "pdx_ref_after_7d",
        flutterwave_tx_id: "flw_tx_ref_late",
        amount_cents: 1000,
        currency: "USD",
        status: "paid",
        paid_at: new Date(paidAt),
      })
      .returning()

    clock = paidAt + 8 * DAY_MS
    const lateRes = await app.request(`/admin/refunds/${latePayment!.id}`, {
      method: "POST",
      headers: { cookie: admin.cookie },
    })
    expect(lateRes.status).toBe(400)
    expect(((await lateRes.json()) as { error: { code: string } }).error.code).toBe("REFUND_WINDOW_EXPIRED")
  })
})

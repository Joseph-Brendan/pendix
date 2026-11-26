import { FakeModel } from "@pendix/grader"
import type { RecorderRecord } from "@pendix/recorder"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { getCreditBalance, insertCreditEntry } from "../src/credits.js"
import { schema } from "../src/db/schema.js"
import { runWeeklyAssessmentScheduler } from "../src/jobs/weekly-assessments.js"
import { createLogger } from "../src/logger.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"
const DAY_MS = 24 * 60 * 60 * 1000

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
  options: { readonly tz?: string; readonly role?: "learner" | "mentor" | "admin"; readonly displayName?: string } = {},
) {
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: options.displayName ?? "Weekly Learner",
      dob: "1996-03-14",
      tz: options.tz ?? "UTC",
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

async function seedGradedSession(
  testDb: TestDatabase,
  userId: string,
  input: {
    readonly projectTitle: string
    readonly filePath: string
    readonly gradedAt: Date
  },
) {
  const [session] = await testDb.db
    .insert(schema.sessions)
    .values({
      user_id: userId,
      source: "terminal",
      project_title: input.projectTitle,
      model: "google/gemini-2.5-pro",
      status: "graded",
      tier: "credit",
      graded_at: input.gradedAt,
      created_at: input.gradedAt,
    })
    .returning()

  const records: RecorderRecord[] = [
    {
      type: "start",
      session_id: session!.id,
      time: input.gradedAt.toISOString(),
      project_name: input.projectTitle,
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: true,
    },
    {
      type: "prompt",
      session_id: session!.id,
      time: input.gradedAt.toISOString(),
      text: `Update ${input.filePath} to validate input and run tests.`,
      files: [input.filePath],
    },
    {
      type: "turn",
      session_id: session!.id,
      time: input.gradedAt.toISOString(),
      tools: { read: 1, edit: 1 },
      files_changed: [{ path: input.filePath, lines_added: 14, lines_removed: 3 }],
      commands: ["vitest"],
      errored: false,
      reply_preview: `Updated ${input.filePath} and ran vitest.`,
    },
    {
      type: "end",
      session_id: session!.id,
      time: input.gradedAt.toISOString(),
      reason: "quit",
    },
  ]

  await testDb.db.insert(schema.sessionRecords).values({
    session_id: session!.id,
    redacted_json: { records },
    created_at: input.gradedAt,
  })

  return session!.id
}

describe("weekly assessments scheduler, credit charging, answering, marking, and mentor visibility", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("gives no assessment to a user with only 1 graded session that week", async () => {
    // Saturday 2026-11-28 09:00 UTC
    const satNineUtc = new Date("2026-11-28T09:00:00.000Z")
    const fakeModel = new FakeModel()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => satNineUtc.getTime(),
    })

    const learner = await createUser(app, testDb, mailer, "one-session@example.com", { tz: "UTC" })
    await insertCreditEntry(testDb.db, { userId: learner.userId, amount: 5, reason: "purchase" })
    await seedGradedSession(testDb, learner.userId, {
      projectTitle: "solo-app",
      filePath: "src/only-one.ts",
      gradedAt: new Date(satNineUtc.getTime() - 2 * DAY_MS),
    })

    const result = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => satNineUtc,
    })

    expect(result.createdUserIds).not.toContain(learner.userId)
    const rows = await testDb.db.select().from(schema.assessments).where(eq(schema.assessments.user_id, learner.userId))
    expect(rows).toHaveLength(0)
  })

  it("charges credit users 2 credits on confirmed open (not creation), leaves balance unchanged on decline, marks late answers, and exposes results to matched mentors", async () => {
    const satNineUtc = new Date("2026-11-28T09:00:00.000Z")
    let clock = satNineUtc.getTime()
    const fakeModel = new FakeModel()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => clock,
    })

    const learner = await createUser(app, testDb, mailer, "credit-assess@example.com", { tz: "UTC" })
    const mentor = await createUser(app, testDb, mailer, "mentor-assess@example.com", { tz: "UTC", role: "mentor" })
    const stranger = await createUser(app, testDb, mailer, "stranger-assess@example.com", { tz: "UTC", role: "mentor" })

    await testDb.db.insert(schema.matches).values({
      learner_user_id: learner.userId,
      mentor_user_id: mentor.userId,
      status: "active",
    })

    await insertCreditEntry(testDb.db, { userId: learner.userId, amount: 5, reason: "purchase" })

    await seedGradedSession(testDb, learner.userId, {
      projectTitle: "shop-api",
      filePath: "src/cart/totals.ts",
      gradedAt: new Date(clock - 3 * DAY_MS),
    })
    await seedGradedSession(testDb, learner.userId, {
      projectTitle: "shop-api",
      filePath: "src/checkout/guard.ts",
      gradedAt: new Date(clock - 1 * DAY_MS),
    })

    // Scheduler creates assessment and sends email, without charging credits.
    const sched = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => new Date(clock),
    })
    expect(sched.createdUserIds).toContain(learner.userId)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(5)
    expect(
      mailer.sent.some((m) => m.to === "credit-assess@example.com" && m.subject === "Your weekly check is ready"),
    ).toBe(true)

    // GET /assessments lists the assessment.
    const listRes = await app.request("/assessments", { headers: { cookie: learner.cookie } })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { assessments: Array<{ id: string; status: string; due_at: string }> }
    expect(listBody.assessments).toHaveLength(1)
    const assessmentId = listBody.assessments[0]!.id
    expect(listBody.assessments[0]!.status).toBe("available")

    // GET /assessments/:id without confirmation does NOT charge and asks for confirmation.
    const previewRes = await app.request(`/assessments/${assessmentId}`, { headers: { cookie: learner.cookie } })
    expect(previewRes.status).toBe(200)
    const previewBody = (await previewRes.json()) as {
      assessment: { status: string; requires_confirmation: boolean; credit_cost: number }
      questions: unknown[]
    }
    expect(previewBody.assessment.status).toBe("available")
    expect(previewBody.assessment.requires_confirmation).toBe(true)
    expect(previewBody.assessment.credit_cost).toBe(2)
    expect(previewBody.questions).toHaveLength(0)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(5)

    // Declining open leaves balance unchanged.
    const declineRes = await app.request(`/assessments/${assessmentId}/open`, {
      method: "POST",
      headers: { cookie: learner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    })
    expect(declineRes.status).toBe(200)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(5)

    // Submitting answers before confirming/opening is blocked so credits cannot be bypassed.
    const blockedSubmit = await app.request(`/assessments/${assessmentId}/answers`, {
      method: "POST",
      headers: { cookie: learner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ answers: ["a", "b", "c", "d", "e"] }),
    })
    expect(blockedSubmit.status).toBe(402)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(5)

    // Confirming open charges exactly 2 credits (5 -> 3) and reveals the 5 questions.
    const openRes = await app.request(`/assessments/${assessmentId}?confirm=true`, {
      headers: { cookie: learner.cookie },
    })
    expect(openRes.status).toBe(200)
    const openedBody = (await openRes.json()) as {
      assessment: { status: string }
      questions: Array<{ question_index: number; question_kind: string; prompt: string }>
    }
    expect(openedBody.assessment.status).toBe("opened")
    expect(openedBody.questions).toHaveLength(5)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(3)

    // Re-opening does NOT charge again.
    const reopenRes = await app.request(`/assessments/${assessmentId}?confirm=true`, {
      headers: { cookie: learner.cookie },
    })
    expect(reopenRes.status).toBe(200)
    expect(await getCreditBalance(testDb.db, learner.userId)).toBe(3)

    // Advance past the 7-day due date (day 9): late answers are still accepted and marked!
    clock += 9 * DAY_MS
    const submitRes = await app.request(`/assessments/${assessmentId}/answers`, {
      method: "POST",
      headers: { cookie: learner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        answers: openedBody.questions.map((q) => ({
          question_index: q.question_index,
          answer: `Detailed answer explaining ${q.prompt.slice(0, 40)}`,
        })),
      }),
    })
    expect(submitRes.status).toBe(200)
    const markedBody = (await submitRes.json()) as {
      assessment: { status: string; total_score: number; is_late: boolean }
      questions: Array<{ question_index: number; score: number; feedback: string; answer: string }>
    }
    expect(markedBody.assessment.status).toBe("graded")
    expect(markedBody.assessment.is_late).toBe(true)
    const sum = markedBody.questions.reduce((acc, q) => acc + q.score, 0)
    expect(markedBody.assessment.total_score).toBe(sum)

    // Matched mentor can list and view the learner's answers and scores.
    const mentorListRes = await app.request(`/assessments?learner_user_id=${learner.userId}`, {
      headers: { cookie: mentor.cookie },
    })
    expect(mentorListRes.status).toBe(200)
    const mentorList = (await mentorListRes.json()) as { assessments: Array<{ id: string; total_score: number }> }
    expect(mentorList.assessments).toHaveLength(1)
    expect(mentorList.assessments[0]!.total_score).toBe(sum)

    const mentorDetailRes = await app.request(`/assessments/${assessmentId}`, {
      headers: { cookie: mentor.cookie },
    })
    expect(mentorDetailRes.status).toBe(200)
    const mentorDetail = (await mentorDetailRes.json()) as {
      assessment: { total_score: number }
      questions: Array<{ answer: string; score: number; feedback: string }>
    }
    expect(mentorDetail.assessment.total_score).toBe(sum)
    expect(mentorDetail.questions).toHaveLength(5)
    expect(mentorDetail.questions[0]!.answer).toContain("Detailed answer")

    // Unmatched mentor cannot view the learner's assessment.
    const strangerRes = await app.request(`/assessments/${assessmentId}`, {
      headers: { cookie: stranger.cookie },
    })
    expect(strangerRes.status).toBe(403)
  })

  it("triggers Lagos and Los Angeles users at their own Saturday 09:00 with a fake clock and does not charge subscribers", async () => {
    // Saturday 2026-11-28:
    // - Africa/Lagos is UTC+1 -> Sat 09:00 Lagos = 2026-11-28T08:00:00Z (LA is Sat 00:00)
    // - America/Los_Angeles is UTC-8 (PST in Nov) -> Sat 09:00 LA = 2026-11-28T17:00:00Z (Lagos is Sat 18:00)
    const beforeLagos = new Date("2026-11-28T07:59:00.000Z")
    const lagosNine = new Date("2026-11-28T08:00:00.000Z")
    const beforeLA = new Date("2026-11-28T16:59:00.000Z")
    const laNine = new Date("2026-11-28T17:00:00.000Z")

    let clock = beforeLagos.getTime()
    const fakeModel = new FakeModel()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => clock,
    })

    const lagosUser = await createUser(app, testDb, mailer, "lagos-sat@example.com", { tz: "Africa/Lagos" })
    const laUser = await createUser(app, testDb, mailer, "la-sat@example.com", { tz: "America/Los_Angeles" })

    // Both are active Solo subscribers (free assessments, zero credits).
    for (const userId of [lagosUser.userId, laUser.userId]) {
      await testDb.db.insert(schema.subscriptions).values({
        user_id: userId,
        plan: "solo",
        period: "monthly",
        status: "active",
        current_period_start: new Date(clock - 10 * DAY_MS),
        current_period_end: new Date(clock + 20 * DAY_MS),
      })
      await seedGradedSession(testDb, userId, {
        projectTitle: "tz-app",
        filePath: "src/api/client.ts",
        gradedAt: new Date(clock - 2 * DAY_MS),
      })
      await seedGradedSession(testDb, userId, {
        projectTitle: "tz-app",
        filePath: "src/api/cache.ts",
        gradedAt: new Date(clock - 1 * DAY_MS),
      })
    }

    // 1. At 07:59Z (08:59 Lagos, 23:59 Fri LA): neither gets an assessment.
    const r0 = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => beforeLagos,
    })
    expect(r0.createdUserIds).not.toContain(lagosUser.userId)
    expect(r0.createdUserIds).not.toContain(laUser.userId)

    // 2. At 08:00Z (09:00 Sat Lagos, 00:00 Sat LA): ONLY Lagos user gets one.
    const r1 = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => lagosNine,
    })
    expect(r1.createdUserIds).toContain(lagosUser.userId)
    expect(r1.createdUserIds).not.toContain(laUser.userId)

    // 3. At 16:59Z (08:59 Sat LA): LA still does not get one; Lagos does not get a duplicate.
    const r2 = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => beforeLA,
    })
    expect(r2.createdUserIds).not.toContain(lagosUser.userId)
    expect(r2.createdUserIds).not.toContain(laUser.userId)

    // 4. At 17:00Z (09:00 Sat LA, 18:00 Sat Lagos): ONLY LA user gets one; Lagos still has 1 total.
    const r3 = await runWeeklyAssessmentScheduler({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
      now: () => laNine,
    })
    expect(r3.createdUserIds).toContain(laUser.userId)
    expect(r3.createdUserIds).not.toContain(lagosUser.userId)

    const lagosRows = await testDb.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.user_id, lagosUser.userId))
    const laRows = await testDb.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.user_id, laUser.userId))
    expect(lagosRows).toHaveLength(1)
    expect(laRows).toHaveLength(1)

    // Subscriber opens without any credit charge (balance remains 0).
    clock = laNine.getTime()
    const subOpen = await app.request(`/assessments/${laRows[0]!.id}`, {
      headers: { cookie: laUser.cookie },
    })
    expect(subOpen.status).toBe(200)
    const subBody = (await subOpen.json()) as { assessment: { status: string }; questions: unknown[] }
    expect(subBody.assessment.status).toBe("opened")
    expect(subBody.questions).toHaveLength(5)
    expect(await getCreditBalance(testDb.db, laUser.userId)).toBe(0)
  })
})

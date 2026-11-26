import { FakeModel } from "@pendix/grader"
import { BRAND_COLOURS } from "@pendix/shared/brand"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { getCreditBalance, insertCreditEntry } from "../src/credits.js"
import { schema } from "../src/db/schema.js"
import { renderSessionReportEmail } from "../src/emails/session-report.js"
import { processNextGradeJob } from "../src/jobs/grade-worker.js"
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

function makeFivePromptUploadBody(sessionId: string): string {
  const promptTexts = [
    "fix login",
    "add button to header",
    "Add Zod validation to POST /signup in src/routes/auth.ts and return 400 on bad email.",
    "Write unit tests in test/auth.test.ts for valid and invalid signup emails using Vitest.",
    "Update src/routes/auth.ts to hash passwords with argon2 without changing response fields, then run vitest.",
  ]
  const records = [
    {
      type: "start",
      session_id: sessionId,
      time: "2026-11-26T10:00:00.000Z",
      project_name: "pendix-shop",
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: true,
    },
    ...promptTexts.map((text, idx) => ({
      type: "prompt",
      session_id: sessionId,
      time: new Date(new Date("2026-11-26T10:00:00.000Z").getTime() + (idx + 1) * 1000).toISOString(),
      text,
      files: idx >= 2 ? ["src/routes/auth.ts"] : [],
    })),
    {
      type: "teach_qa",
      session_id: sessionId,
      time: "2026-11-26T10:05:00.000Z",
      question: "Why do we hash passwords instead of storing plaintext?",
      answer: "So a database leak never exposes user passwords directly.",
    },
  ]

  return JSON.stringify({
    source: "terminal",
    local_session_id: sessionId,
    project_title: "pendix-shop",
    model: "gemini-2.5-pro",
    records,
  })
}

function makeFakeModelWithKnownScores() {
  // Totals: 5, 6, 8, 9, 9 => sum = 37 => average = 7.4/10.
  const presetTotals = [
    { goal: 1, context: 1, constraints: 1, verification: 1, steps: 1, total: 5 },
    { goal: 2, context: 1, constraints: 1, verification: 1, steps: 1, total: 6 },
    { goal: 2, context: 2, constraints: 1, verification: 1, steps: 2, total: 8 },
    { goal: 2, context: 2, constraints: 1, verification: 2, steps: 2, total: 9 },
    { goal: 2, context: 2, constraints: 2, verification: 1, steps: 2, total: 9 },
  ] as const

  return new FakeModel({
    onGenerate: () => ({
      prompts: presetTotals.map((p, idx) => ({
        prompt_index: idx,
        scores: {
          goal: p.goal,
          context: p.context,
          constraints: p.constraints,
          verification: p.verification,
          steps: p.steps,
        },
        reasons: {
          goal: idx === 0 ? "Goal is vague without naming the login bug." : "Clear goal stated.",
          context: idx <= 1 ? "Missing exact file path and stack context." : "Files and stack named.",
          constraints: "Limits could be more explicit.",
          verification: idx <= 2 ? "No concrete check or test command given." : "Concrete test check named.",
          steps: "Reasonably scoped step.",
        },
        total: p.total,
        improved_prompt: `Improved prompt ${idx + 1}: name the exact file, state constraints, and include a test check.`,
        confidence: 0.9,
      })),
      understanding: {
        score: 8,
        reason: "Explained password hashing clearly and verified changes with tests.",
      },
      notes: {
        what_was_built: "Added signup validation, password hashing, and Vitest auth tests in pendix-shop.",
        things_learned: [
          "Validate inputs on the server with Zod.",
          "Store only hashed passwords using argon2.",
          "Write focused Vitest cases for error paths.",
        ],
        things_to_work_on: [
          "Name exact files in your first prompt.",
          "Include a concrete test command for every edit.",
        ],
        summary:
          "You added signup validation, password hashing, and auth tests in pendix-shop. You practiced server validation, password hashing, and writing Vitest checks. Next time, name files up front and add explicit test commands.",
      },
    }),
  })
}

async function createVerifiedConsentedUser(
  app: ReturnType<typeof createApp>,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
  displayName: string,
) {
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: displayName,
      dob: "1996-05-10",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signup.status).toBe(201)
  const { user } = (await signup.json()) as { user: { id: string } }
  const verifyMail = mailer.sent.find((m) => m.to === email)!
  const verifyUrl = new URL(extractVerifyUrl(verifyMail.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  const login = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  expect(login.status).toBe(200)
  const cookie = extractCookie(login)

  const consent = await app.request("/consents/grading", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ granted: true, version: "2026-01" }),
  })
  expect(consent.status).toBe(201)
  mailer.clear()

  return { userId: user.id, cookie }
}

describe("grading worker, retries/refunds, and React Email reports", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("uploads a session, runs the worker with FakeModel, stores grades/notes/model, and emails the report with right numbers", async () => {
    let clock = new Date("2026-11-26T12:00:00.000Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
    })

    const { userId, cookie } = await createVerifiedConsentedUser(app, mailer, "worker-happy@example.com", "Ada Learner")
    await insertCreditEntry(testDb.db, {
      userId,
      amount: 3,
      reason: "purchase",
      referenceId: "pay_worker_1",
    })

    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeFivePromptUploadBody("ses_worker_happy"),
    })
    expect(uploadRes.status).toBe(201)
    const { id: sessionId } = (await uploadRes.json()) as { id: string }
    expect(await getCreditBalance(testDb.db, userId)).toBe(2)

    const fakeModel = makeFakeModelWithKnownScores()
    clock += 5_000
    const outcome = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
    })

    expect(outcome).toMatchObject({ status: "completed", sessionId, emailed: true })

    // Verify SELECT ... FOR UPDATE SKIP LOCKED was executed against jobs.
    const skipLockedQueries = testDb.queries.filter(
      (q) => /jobs/i.test(q) && /for\s+update\s+skip\s+locked/i.test(q),
    )
    expect(skipLockedQueries.length).toBeGreaterThan(0)

    const storedGrades = await testDb.db
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.session_id, sessionId))
    expect(storedGrades).toHaveLength(5)
    expect(storedGrades[0]!.model_used).toBe("deepseek/deepseek-flash")

    const [storedNotes] = await testDb.db
      .select()
      .from(schema.sessionNotes)
      .where(eq(schema.sessionNotes.session_id, sessionId))
    expect(storedNotes?.what_was_built).toContain("pendix-shop")
    expect(storedNotes?.model_used).toBe("deepseek/deepseek-flash")

    const [storedUnderstanding] = await testDb.db
      .select()
      .from(schema.understandingScores)
      .where(eq(schema.understandingScores.session_id, sessionId))
    expect(storedUnderstanding?.score).toBe(8)

    const [storedSession] = await testDb.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
    expect(storedSession?.status).toBe("graded")
    expect(storedSession?.graded_at).toBeTruthy()
    expect(storedSession?.report_emailed_at).toBeTruthy()

    // GET /sessions exposes score 7.4 and report_emailed true.
    const listRes = await app.request("/sessions", { headers: { cookie } })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      sessions: Array<{ id: string; status: string; score: number; report_emailed: boolean }>
    }
    expect(listBody.sessions[0]).toMatchObject({
      id: sessionId,
      status: "graded",
      score: 7.4,
      report_emailed: true,
    })

    // Exactly one email sent with right numbers and weakest prompts.
    expect(mailer.sent).toHaveLength(1)
    const reportEmail = mailer.sent[0]!
    expect(reportEmail.to).toBe("worker-happy@example.com")
    expect(reportEmail.html).toContain("pendix-shop")
    expect(reportEmail.html).toContain("7.4/10")
    expect(reportEmail.html).toContain("8/10")
    expect(reportEmail.html).toContain("fix login")
    expect(reportEmail.html).toContain("add button to header")
    expect(reportEmail.html).toContain("Improved prompt 1")
    expect(reportEmail.html).toContain("Improved prompt 2")
    expect(reportEmail.html).toContain("See full report")
    expect(reportEmail.html).toContain(`https://app.pendix.dev/sessions/${sessionId}`)
    expect(reportEmail.html).not.toContain("\u2014")
    expect(reportEmail.html).not.toContain("\u2013")
  })

  it("retries up to 3 attempts with backoff, then marks failed, refunds the credit, and sends no email", async () => {
    let clock = new Date("2026-11-26T13:00:00.000Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
    })

    const { userId, cookie } = await createVerifiedConsentedUser(app, mailer, "worker-fail3@example.com", "Femi Fail")
    await insertCreditEntry(testDb.db, {
      userId,
      amount: 1,
      reason: "purchase",
      referenceId: "pay_fail3",
    })

    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeFivePromptUploadBody("ses_worker_fail3"),
    })
    expect(uploadRes.status).toBe(201)
    const { id: sessionId } = (await uploadRes.json()) as { id: string }
    expect(await getCreditBalance(testDb.db, userId)).toBe(0)

    const failingModel = new FakeModel({
      onGenerate: () => {
        throw new Error("Simulated provider outage")
      },
    })

    // Attempt 1 fails -> retried with backoff, no refund yet.
    const r1 = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
      modelFactory: (spec) => failingModel.asLanguageModel(spec),
      backoffMs: (attempt) => attempt * 10_000,
    })
    expect(r1).toMatchObject({ status: "retrying", sessionId, attempts: 1 })
    expect(await getCreditBalance(testDb.db, userId)).toBe(0)

    // Before backoff expires, nothing is claimed.
    clock += 5_000
    const beforeBackoff = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
      modelFactory: (spec) => failingModel.asLanguageModel(spec),
      backoffMs: (attempt) => attempt * 10_000,
    })
    expect(beforeBackoff).toBeNull()

    // Attempt 2 fails -> scheduled for attempt 3, still no refund.
    clock += 10_000
    const r2 = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
      modelFactory: (spec) => failingModel.asLanguageModel(spec),
      backoffMs: (attempt) => attempt * 10_000,
    })
    expect(r2).toMatchObject({ status: "retrying", sessionId, attempts: 2 })
    expect(await getCreditBalance(testDb.db, userId)).toBe(0)

    // Attempt 3 fails -> permanently failed, credit refunded, no email sent.
    clock += 25_000
    const r3 = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
      modelFactory: (spec) => failingModel.asLanguageModel(spec),
      backoffMs: (attempt) => attempt * 10_000,
    })
    expect(r3).toMatchObject({ status: "failed", sessionId, attempts: 3, refunded: true })
    expect(await getCreditBalance(testDb.db, userId)).toBe(1)
    expect(mailer.sent).toHaveLength(0)

    const [sessionRow] = await testDb.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
    expect(sessionRow?.status).toBe("failed")
  })

  it("stores grades on the dashboard without sending an email when user turns off report emails", async () => {
    const clock = new Date("2026-11-26T14:00:00.000Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      webUrl: "https://app.pendix.dev",
      now: () => clock,
    })

    const { userId, cookie } = await createVerifiedConsentedUser(app, mailer, "no-emails@example.com", "Quiet Learner")
    await insertCreditEntry(testDb.db, {
      userId,
      amount: 2,
      reason: "purchase",
      referenceId: "pay_quiet",
    })

    const prefRes = await app.request("/me/preferences", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ session_report_emails: false }),
    })
    expect(prefRes.status).toBe(200)
    expect(await prefRes.json()).toEqual({ session_report_emails: false })

    const uploadRes = await app.request("/sessions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: makeFivePromptUploadBody("ses_no_email"),
    })
    expect(uploadRes.status).toBe(201)
    const { id: sessionId } = (await uploadRes.json()) as { id: string }

    const fakeModel = makeFakeModelWithKnownScores()
    const outcome = await processNextGradeJob({
      db: testDb.db,
      mailer,
      webUrl: "https://app.pendix.dev",
      now: () => clock + 1000,
      modelFactory: (spec) => fakeModel.asLanguageModel(spec),
    })

    expect(outcome).toMatchObject({ status: "completed", sessionId, emailed: false })
    expect(mailer.sent).toHaveLength(0)

    const storedGrades = await testDb.db
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.session_id, sessionId))
    expect(storedGrades).toHaveLength(5)

    const [sessionRow] = await testDb.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
    expect(sessionRow?.status).toBe("graded")
    expect(sessionRow?.report_emailed_at).toBeNull()
  })

  it("matches the HTML snapshot for the branded React Email session report", async () => {
    const email = await renderSessionReportEmail({
      to: "ada@example.com",
      displayName: "Ada Learner",
      sessionTitle: "pendix-shop",
      sessionDate: "2026-11-26",
      promptScore: 7.4,
      understandingScore: 8,
      understandingReason: "Explained password hashing clearly and verified changes with tests.",
      weakestPrompts: [
        {
          promptIndex: 0,
          original: "fix login",
          score: 5,
          improved: "Update POST /login in src/routes/auth.ts to verify password hash and return 401 on mismatch.",
          why: "Goal is vague without naming the login bug. Missing exact file path and stack context.",
        },
        {
          promptIndex: 1,
          original: "add button to header",
          score: 6,
          improved: "Add a Sign out button to src/components/Header.tsx using the secondary style and test click.",
          why: "Missing exact file path and stack context. No concrete check or test command given.",
        },
      ],
      notes: {
        what_was_built: "Added signup validation, password hashing, and Vitest auth tests in pendix-shop.",
        things_learned: [
          "Validate inputs on the server with Zod.",
          "Store only hashed passwords using argon2.",
          "Write focused Vitest cases for error paths.",
        ],
        things_to_work_on: [
          "Name exact files in your first prompt.",
          "Include a concrete test command for every edit.",
        ],
        summary:
          "You added signup validation, password hashing, and auth tests in pendix-shop. Next time, name files up front and add explicit test commands.",
      },
      reportUrl: "https://app.pendix.dev/sessions/ses_snapshot_1",
    })

    expect(email.html).toContain(BRAND_COLOURS.offWhite)
    expect(email.html).toContain(BRAND_COLOURS.ink)
    expect(email.html).toContain(BRAND_COLOURS.hotOrange)
    expect(email.html).toContain("See full report")
    expect(email.html).not.toContain("\u2014")
    expect(email.html).not.toContain("\u2013")
    expect(email.html).toMatchSnapshot()
  })
})

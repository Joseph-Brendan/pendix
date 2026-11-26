import { FakeModel } from "@pendix/grader"
import type { RecorderRecord } from "@pendix/recorder"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createApp } from "../../src/app.js"
import { createFakeFlutterwaveClient, type FlutterwaveClient } from "../../src/billing/flutterwave.js"
import { syncFlutterwavePlans } from "../../src/billing/plans-sync.js"
import { schema } from "../../src/db/schema.js"
import { createLogger } from "../../src/logger.js"
import { createFakeMailer } from "../../src/mailer.js"
import { createTestDatabase } from "./db.js"

const PORT = Number(process.env.E2E_API_PORT ?? 4301)
const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:4173"
const API_URL = `http://127.0.0.1:${PORT}`

const testDb = await createTestDatabase()
const mailer = createFakeMailer()
const fakeModel = new FakeModel()
const baseFlw = createFakeFlutterwaveClient()

const pendingCheckouts = new Map<string, { amount_cents: number; currency: string }>()
let fakeTxSeq = 1

const flutterwave: FlutterwaveClient = {
  ...baseFlw,
  async createStandardCheckout(input) {
    await baseFlw.createStandardCheckout(input)
    pendingCheckouts.set(input.tx_ref, {
      amount_cents: input.amount_cents,
      currency: input.currency,
    })
    return {
      link: `${API_URL}/__test/fake-checkout?tx_ref=${encodeURIComponent(input.tx_ref)}`,
    }
  },
}

await syncFlutterwavePlans({ db: testDb.db, flutterwave: baseFlw })

const cloudApp = createApp({
  version: "0.1.0-e2e",
  nodeEnv: "test",
  logger: createLogger({ level: "warn" }),
  db: testDb.db,
  mailer,
  authSecret: "e2e-test-auth-secret-32-bytes-long",
  apiUrl: API_URL,
  webUrl: WEB_URL,
  flutterwave,
  flwWebhookHash: "e2e-test-webhook-hash",
  modelFactory: (spec) => fakeModel.asLanguageModel(spec),
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

// Simulates completing Flutterwave Standard Checkout in E2E tests and redirecting back to /billing/redirect.
wrapper.get("/__test/fake-checkout", (c) => {
  const txRef = c.req.query("tx_ref") ?? ""
  const pending = pendingCheckouts.get(txRef)
  if (!pending) {
    return c.text("Unknown fake checkout tx_ref", 404)
  }
  const txId = `flw_e2e_${fakeTxSeq++}`
  baseFlw.recordTransaction({
    id: txId,
    tx_ref: txRef,
    flw_ref: `FLW-E2E-${txId}`,
    amount: pending.amount_cents / 100,
    currency: pending.currency,
    status: "successful",
  })
  const redirectUrl = new URL("/billing/redirect", API_URL)
  redirectUrl.searchParams.set("transaction_id", txId)
  redirectUrl.searchParams.set("tx_ref", txRef)
  redirectUrl.searchParams.set("status", "successful")
  return c.redirect(redirectUrl.toString(), 302)
})

wrapper.post("/__test/seed-sessions", async (c) => {
  const body = (await c.req.json()) as { user_id: string; count?: number }
  const count = body.count ?? 3
  const nowMs = Date.now()
  const sessionIds: string[] = []

  for (let i = 1; i <= count; i += 1) {
    const createdAt = new Date(nowMs - (count - i) * 24 * 60 * 60 * 1000)
    const [sessionRow] = await testDb.db
      .insert(schema.sessions)
      .values({
        user_id: body.user_id,
        source: "terminal",
        project_title: `Project Alpha ${i}`,
        model: "google/gemini-2.5-pro",
        status: "graded",
        tier: "subscriber",
        graded_at: createdAt,
        created_at: createdAt,
      })
      .returning()

    const records: RecorderRecord[] = [
      {
        type: "start",
        session_id: sessionRow!.id,
        time: createdAt.toISOString(),
        project_name: `Project Alpha ${i}`,
        provider: "google",
        model: "gemini-2.5-pro",
        teach_mode: true,
      },
      {
        type: "prompt",
        session_id: sessionRow!.id,
        time: createdAt.toISOString(),
        text: `Fix validation in src/feature-${i}.ts`,
        files: [`src/feature-${i}.ts`],
      },
      {
        type: "prompt",
        session_id: sessionRow!.id,
        time: createdAt.toISOString(),
        text: `Add unit tests for src/feature-${i}.ts and verify error handling.`,
        files: [`src/feature-${i}.ts`],
      },
      {
        type: "end",
        session_id: sessionRow!.id,
        time: createdAt.toISOString(),
        reason: "quit",
      },
    ]

    await testDb.db.insert(schema.sessionRecords).values({
      session_id: sessionRow!.id,
      redacted_json: { records },
      created_at: createdAt,
    })

    await testDb.db.insert(schema.grades).values([
      {
        session_id: sessionRow!.id,
        prompt_index: 0,
        scores: { goal: 2, context: 1, constraints: 1, verification: 1, steps: 2 },
        reasons: {
          goal: "Clear feature target.",
          context: "Names the file but not current failure mode.",
          constraints: "Could state what not to change.",
          verification: "No explicit test command.",
          steps: "Scoped to one step.",
        },
        total: 7,
        improved_prompt: `Update src/feature-${i}.ts to reject empty payloads, keep existing exports intact, and run vitest.`,
        confidence: 0.9,
        model_used: "google/gemini-4-argon",
        created_at: createdAt,
      },
      {
        session_id: sessionRow!.id,
        prompt_index: 1,
        scores: { goal: 2, context: 2, constraints: 2, verification: 2, steps: 2 },
        reasons: {
          goal: "Specific test goal.",
          context: "Names exact file.",
          constraints: "Focused on error handling.",
          verification: "Explicit test coverage ask.",
          steps: "Single clean step.",
        },
        total: 10,
        improved_prompt: `Add unit tests in test/feature-${i}.test.ts covering valid and invalid input and confirm vitest passes.`,
        confidence: 0.95,
        model_used: "google/gemini-4-argon",
        created_at: createdAt,
      },
    ])

    await testDb.db.insert(schema.understandingScores).values({
      session_id: sessionRow!.id,
      score: 8,
      reason: "Explained server-side validation clearly in teach mode.",
      model_used: "google/gemini-4-argon",
      created_at: createdAt,
    })

    await testDb.db.insert(schema.sessionNotes).values({
      session_id: sessionRow!.id,
      what_was_built: `Added validation and tests for Project Alpha ${i}.`,
      learned: [
        "Validate input on the server.",
        "Keep prompts scoped to one file.",
        "Run unit tests right after edits.",
      ],
      to_work_on: ["State explicit constraints.", "Include failure cases in verification."],
      summary: `Built validation and tests in Project Alpha ${i}.`,
      model_used: "google/gemini-4-argon",
      created_at: createdAt,
    })

    sessionIds.push(sessionRow!.id)
  }

  return c.json({ session_ids: sessionIds }, 201)
})

wrapper.post("/__test/seed-assessment", async (c) => {
  const body = (await c.req.json()) as { user_id: string; subscriber?: boolean }
  const now = new Date()
  const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  if (body.subscriber) {
    await testDb.db.insert(schema.subscriptions).values({
      user_id: body.user_id,
      plan: "solo",
      period: "monthly",
      status: "active",
      current_period_start: now,
      current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    })
  }

  const [assessment] = await testDb.db
    .insert(schema.assessments)
    .values({
      user_id: body.user_id,
      week_key: now.toISOString().slice(0, 10),
      tier: body.subscriber ? "subscriber" : "credit",
      model_used: "google/gemini-4-argon",
      status: "available",
      due_at: dueAt,
      created_at: now,
    })
    .returning()

  await testDb.db.insert(schema.assessmentAnswers).values([
    {
      assessment_id: assessment!.id,
      question_index: 0,
      question_kind: "why",
      reference_target: "src/feature-1.ts",
      prompt: "Why did the agent validate payloads on the server in src/feature-1.ts?",
      reference_answer: "Clients can bypass browser checks.",
      created_at: now,
    },
    {
      assessment_id: assessment!.id,
      question_index: 1,
      question_kind: "why",
      reference_target: "src/feature-2.ts",
      prompt: "Why did the agent keep exports unchanged in src/feature-2.ts?",
      reference_answer: "So callers do not break.",
      created_at: now,
    },
    {
      assessment_id: assessment!.id,
      question_index: 2,
      question_kind: "what_would_break",
      reference_target: "src/feature-1.ts",
      prompt: "What would break if the guard in src/feature-1.ts were removed?",
      reference_answer: "Empty payloads could reach the database.",
      created_at: now,
    },
    {
      assessment_id: assessment!.id,
      question_index: 3,
      question_kind: "how_to_check",
      reference_target: "src/feature-2.ts",
      prompt: "How would you check that invalid input is rejected in src/feature-2.ts?",
      reference_answer: "Send an empty payload in a unit test and assert a 400 error.",
      created_at: now,
    },
    {
      assessment_id: assessment!.id,
      question_index: 4,
      question_kind: "multiple_choice",
      reference_target: "src/feature-1.ts",
      prompt: "Which check best verifies src/feature-1.ts?",
      choices: [
        "Running unit tests for valid and invalid input",
        "Skipping tests on save",
        "Disabling TypeScript checks",
        "Ignoring HTTP error codes",
      ],
      reference_answer: "Running unit tests for valid and invalid input",
      created_at: now,
    },
  ])

  return c.json({ assessment_id: assessment!.id }, 201)
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

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
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

function extractApprovalToken(text: string): string {
  const match = /approval\/([A-Za-z0-9._-]+)/.exec(text) ?? /token=([A-Za-z0-9._-]+)/.exec(text)
  if (!match?.[1]) throw new Error(`No approval token found in email: ${text}`)
  return match[1]
}

describe("teen accounts and guardian consent", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("rejects teen sign-up when guardian email matches the teen's own email", async () => {
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => new Date("2026-11-25T10:00:00Z").getTime(),
    })

    const res = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "teen-same@example.com",
        password: "Password123!",
        display_name: "Same Email Teen",
        dob: "2010-03-10",
        guardian_email: "TEEN-SAME@example.com",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_GUARDIAN_EMAIL")
    expect(await testDb.db.select().from(schema.users).where(eq(schema.users.email, "teen-same@example.com"))).toHaveLength(
      0,
    )
    expect(mailer.sent).toHaveLength(0)
  })

  it("sets teen to pending_guardian, sends guardian one email, blocks protected routes with 403 GUARDIAN_PENDING, and activates on approval", async () => {
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now: () => currentTime,
    })

    const signupRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "teen1@example.com",
        password: "Password123!",
        display_name: "Tunde Teen",
        dob: "2010-05-01",
        guardian_email: "parent@example.com",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(signupRes.status).toBe(201)
    const { user: teen } = (await signupRes.json()) as {
      user: { id: string; account_kind: string; status: string }
    }
    expect(teen.account_kind).toBe("teen")
    expect(teen.status).toBe("pending_guardian")

    const guardianEmails = mailer.sent.filter((m) => m.to === "parent@example.com")
    expect(guardianEmails).toHaveLength(1)
    const token = extractApprovalToken(guardianEmails[0]!.text)

    // Verify teen email so sign-in succeeds, then confirm protected routes still return 403 GUARDIAN_PENDING.
    const teenEmail = mailer.sent.find((m) => m.to === "teen1@example.com")!
    const verifyMatch = /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i.exec(teenEmail.text)
    if (verifyMatch) {
      const verifyUrl = new URL(verifyMatch[0])
      await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)
    }

    const loginRes = await app.request("/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "teen1@example.com", password: "Password123!" }),
    })
    expect(loginRes.status).toBe(200)
    const teenCookie = extractCookie(loginRes)

    const protectedRes = await app.request("/sessions", { headers: { cookie: teenCookie } })
    expect(protectedRes.status).toBe(403)
    expect(((await protectedRes.json()) as { error: { code: string } }).error.code).toBe("GUARDIAN_PENDING")

    // GET approval page shows teen's display name and what Pendix is.
    const infoRes = await app.request(`/guardian/approval/${token}`)
    expect(infoRes.status).toBe(200)
    const info = (await infoRes.json()) as { teen_display_name: string; about_pendix: string }
    expect(info.teen_display_name).toBe("Tunde Teen")
    expect(info.about_pendix).toContain("Pendix")

    // POST approve via email link activates teen, creates guardian record, and records guardian consent version.
    const approveRes = await app.request(`/guardian/approval/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", consent_version: "2026-01" }),
    })
    expect(approveRes.status).toBe(200)
    const approved = (await approveRes.json()) as {
      ok: boolean
      decision: string
      guardian_user_id: string
    }
    expect(approved.ok).toBe(true)
    expect(approved.decision).toBe("approved")
    expect(approved.guardian_user_id).toBeTruthy()

    const [updatedTeen] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, teen.id))
    expect(updatedTeen?.status).toBe("active")

    const guardianRows = await testDb.db
      .select()
      .from(schema.guardians)
      .where(eq(schema.guardians.teen_user_id, teen.id))
    expect(guardianRows).toHaveLength(1)
    expect(guardianRows[0]?.approved_at).not.toBeNull()
    expect(guardianRows[0]?.guardian_user_id).toBe(approved.guardian_user_id)

    const consents = await testDb.db.select().from(schema.consents).where(eq(schema.consents.user_id, teen.id))
    expect(consents.map((c) => `${c.kind}:${c.version}`).sort()).toEqual([
      "guardian:2026-01",
      "privacy:2026-01",
      "terms:2026-01",
    ])

    // Teen can now access protected routes.
    const activeProtectedRes = await app.request("/sessions", { headers: { cookie: teenCookie } })
    expect(activeProtectedRes.status).toBe(200)

    // Same guardian can link to a second teen.
    const teen2Signup = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "teen2@example.com",
        password: "Password123!",
        display_name: "Zara Teen",
        dob: "2010-08-12",
        guardian_email: "parent@example.com",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(teen2Signup.status).toBe(201)
    const teen2Emails = mailer.sent.filter((m) => m.to === "parent@example.com")
    const token2 = extractApprovalToken(teen2Emails[teen2Emails.length - 1]!.text)
    const approve2 = await app.request(`/guardian/approval/${token2}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", consent_version: "2026-01" }),
    })
    expect(approve2.status).toBe(200)
    const linked = await testDb.db
      .select()
      .from(schema.guardians)
      .where(eq(schema.guardians.guardian_user_id, approved.guardian_user_id))
    expect(linked).toHaveLength(2)
  })

  it("guardian decline deletes the teen account and all related data", async () => {
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => new Date("2026-11-25T10:00:00Z").getTime(),
    })

    const signupRes = await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "declined-teen@example.com",
        password: "Password123!",
        display_name: "Declined Teen",
        dob: "2010-07-01",
        guardian_email: "decline-parent@example.com",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    const { user: teen } = (await signupRes.json()) as { user: { id: string } }
    const guardianEmail = mailer.sent.find((m) => m.to === "decline-parent@example.com")!
    const token = extractApprovalToken(guardianEmail.text)

    const declineRes = await app.request(`/guardian/approval/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "decline" }),
    })
    expect(declineRes.status).toBe(200)
    expect(await declineRes.json()).toEqual({ ok: true, decision: "declined" })

    expect(await testDb.db.select().from(schema.users).where(eq(schema.users.id, teen.id))).toHaveLength(0)
    expect(await testDb.db.select().from(schema.guardians).where(eq(schema.guardians.teen_user_id, teen.id))).toHaveLength(
      0,
    )
    expect(await testDb.db.select().from(schema.consents).where(eq(schema.consents.user_id, teen.id))).toHaveLength(0)
  })

  it("rejects an expired approval link after 7 days", async () => {
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      now: () => currentTime,
    })

    await app.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "expired-teen@example.com",
        password: "Password123!",
        display_name: "Expired Teen",
        dob: "2010-04-12",
        guardian_email: "expired-parent@example.com",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    const guardianEmail = mailer.sent.find((m) => m.to === "expired-parent@example.com")!
    const token = extractApprovalToken(guardianEmail.text)

    // Advance fake clock 7 days + 1 second.
    currentTime += 7 * 24 * 60 * 60 * 1000 + 1000

    const getRes = await app.request(`/guardian/approval/${token}`)
    expect(getRes.status).toBe(410)
    expect(((await getRes.json()) as { error: { code: string } }).error.code).toBe("APPROVAL_LINK_EXPIRED")

    const postRes = await app.request(`/guardian/approval/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", consent_version: "2026-01" }),
    })
    expect(postRes.status).toBe(410)
    expect(((await postRes.json()) as { error: { code: string } }).error.code).toBe("APPROVAL_LINK_EXPIRED")
  })
})

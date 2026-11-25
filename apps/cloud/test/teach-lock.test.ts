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

function extractVerifyUrl(text: string): string {
  const match = /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i.exec(text)
  if (!match) throw new Error(`No verify URL found in email: ${text}`)
  return match[0]
}

async function createVerifiedUserSession(
  app: ReturnType<typeof createApp>,
  mailer: ReturnType<typeof createFakeMailer>,
  email: string,
  displayName: string,
) {
  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Password123!",
      display_name: displayName,
      dob: "1998-04-10",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signupRes.status).toBe(201)
  const signupBody = (await signupRes.json()) as { user: { id: string } }
  const mail = mailer.sent.find((m) => m.to === email)
  expect(mail).toBeDefined()
  const verifyUrl = new URL(extractVerifyUrl(mail!.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  const loginRes = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  expect(loginRes.status).toBe(200)
  return {
    userId: signupBody.user.id,
    cookie: extractCookie(loginRes),
  }
}

describe("GET /me teach_lock", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("returns teach_lock none by default, self when user self-locks, and class when a group locks it", async () => {
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
    })

    const learner = await createVerifiedUserSession(app, mailer, "learner-lock@example.com", "Ada Learner")
    const owner = await createVerifiedUserSession(app, mailer, "owner-lock@example.com", "Instructor Sam")

    // Default is none.
    const defaultRes = await app.request("/me", { headers: { cookie: learner.cookie } })
    expect(defaultRes.status).toBe(200)
    expect((await defaultRes.json()) as { teach_lock: string }).toMatchObject({ teach_lock: "none" })

    // User enables self lock.
    await testDb.db
      .update(schema.users)
      .set({ teach_lock: "self" })
      .where(eq(schema.users.id, learner.userId))

    const selfRes = await app.request("/me", { headers: { cookie: learner.cookie } })
    expect(selfRes.status).toBe(200)
    expect((await selfRes.json()) as { teach_lock: string }).toMatchObject({ teach_lock: "self" })

    // Instructor creates a group with class lock and adds the learner.
    const [group] = await testDb.db
      .insert(schema.groups)
      .values({
        owner_user_id: owner.userId,
        name: "Cohort 1",
        teach_lock: "class",
      })
      .returning()

    await testDb.db.insert(schema.groupMembers).values({
      group_id: group!.id,
      user_id: learner.userId,
      role: "member",
    })

    // Class lock overrides both none and self.
    const classRes = await app.request("/me", { headers: { cookie: learner.cookie } })
    expect(classRes.status).toBe(200)
    expect((await classRes.json()) as { teach_lock: string }).toMatchObject({ teach_lock: "class" })

    // Removing the class lock falls back to self, and clearing self returns none.
    await testDb.db
      .update(schema.groups)
      .set({ teach_lock: "none" })
      .where(eq(schema.groups.id, group!.id))

    const fallbackSelfRes = await app.request("/me", { headers: { cookie: learner.cookie } })
    expect((await fallbackSelfRes.json()) as { teach_lock: string }).toMatchObject({ teach_lock: "self" })

    await testDb.db
      .update(schema.users)
      .set({ teach_lock: "none" })
      .where(eq(schema.users.id, learner.userId))

    const unlockedRes = await app.request("/me", { headers: { cookie: learner.cookie } })
    expect((await unlockedRes.json()) as { teach_lock: string }).toMatchObject({ teach_lock: "none" })
  })
})

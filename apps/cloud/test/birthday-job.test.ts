import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { schema } from "../src/db/schema.js"
import { runBirthdayPromotionJob } from "../src/jobs/birthday.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

describe("daily 18th birthday promotion job", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("promotes a teen turning 18 today to adult and emails both the user and guardian", async () => {
    const mailer = createFakeMailer()

    const [turning18] = await testDb.db
      .insert(schema.users)
      .values({
        email: "turning18@example.com",
        display_name: "Kemi Turning18",
        dob: "2008-11-25",
        account_kind: "teen",
        status: "active",
        email_verified: true,
      })
      .returning()

    const [still17] = await testDb.db
      .insert(schema.users)
      .values({
        email: "still17@example.com",
        display_name: "Still Seventeen",
        dob: "2008-11-26",
        account_kind: "teen",
        status: "active",
        email_verified: true,
      })
      .returning()

    await testDb.db.insert(schema.guardians).values({
      email: "kemi-guardian@example.com",
      teen_user_id: turning18!.id,
      approved_at: new Date("2025-01-01T00:00:00Z"),
    })

    const result = await runBirthdayPromotionJob({
      db: testDb.db,
      mailer,
      now: () => new Date("2026-11-25T09:00:00Z"),
    })

    expect(result.promotedUserIds).toEqual([turning18!.id])
    expect(result.promotedCount).toBe(1)

    const [promotedRow] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, turning18!.id))
    expect(promotedRow?.account_kind).toBe("adult")
    expect(promotedRow?.status).toBe("active")

    const [stillTeenRow] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, still17!.id))
    expect(stillTeenRow?.account_kind).toBe("teen")

    const userMail = mailer.sent.find((m) => m.to === "turning18@example.com")
    const guardianMail = mailer.sent.find((m) => m.to === "kemi-guardian@example.com")
    expect(userMail).toBeDefined()
    expect(guardianMail).toBeDefined()
    expect(mailer.sent.find((m) => m.to === "still17@example.com")).toBeUndefined()
  })
})

import { accountKindFor } from "@pendix/shared/age"
import { eq } from "drizzle-orm"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import {
  buildEighteenthBirthdayGuardianEmail,
  buildEighteenthBirthdayUserEmail,
  type Mailer,
} from "../mailer.js"

export interface BirthdayJobOptions {
  readonly db: CloudDatabase
  readonly mailer: Mailer
  readonly now?: () => Date
}

export interface BirthdayJobResult {
  readonly promotedCount: number
  readonly promotedUserIds: readonly string[]
}

export async function runBirthdayPromotionJob(options: BirthdayJobOptions): Promise<BirthdayJobResult> {
  const today = (options.now ?? (() => new Date()))()
  const teens = await options.db.select().from(schema.users).where(eq(schema.users.account_kind, "teen"))

  const promotedUserIds: string[] = []

  for (const teen of teens) {
    if (teen.status === "closed" || !teen.dob) continue
    if (accountKindFor(teen.dob, today) !== "adult") continue

    const nextStatus = teen.status === "pending_guardian" && teen.email_verified ? "active" : teen.status

    await options.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          account_kind: "adult",
          status: nextStatus,
          updated_at: today,
        })
        .where(eq(schema.users.id, teen.id))

      await tx.insert(schema.auditLog).values({
        actor_user_id: teen.id,
        action: "user.birthday_promotion",
        target_type: "user",
        target_id: teen.id,
        before: { account_kind: teen.account_kind, status: teen.status },
        after: { account_kind: "adult", status: nextStatus },
      })
    })

    await options.mailer.send(
      buildEighteenthBirthdayUserEmail({
        to: teen.email,
        displayName: teen.display_name,
      }),
    )

    const linkedGuardians = await options.db
      .select()
      .from(schema.guardians)
      .where(eq(schema.guardians.teen_user_id, teen.id))

    const notified = new Set<string>()
    for (const guardian of linkedGuardians) {
      const email = guardian.email.toLowerCase()
      if (notified.has(email)) continue
      notified.add(email)
      await options.mailer.send(
        buildEighteenthBirthdayGuardianEmail({
          to: email,
          teenDisplayName: teen.display_name,
        }),
      )
    }

    promotedUserIds.push(teen.id)
  }

  return {
    promotedCount: promotedUserIds.length,
    promotedUserIds,
  }
}

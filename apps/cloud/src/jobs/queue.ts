import { and, asc, eq, lte } from "drizzle-orm"
import type { DbExecutor } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"

export type JobRow = typeof schema.jobs.$inferSelect

export interface EnqueueJobInput {
  readonly kind: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly runAt?: Date
  readonly createdAt?: Date
}

export async function enqueueJob(db: DbExecutor, input: EnqueueJobInput): Promise<JobRow> {
  const now = input.createdAt ?? new Date()
  const [created] = await db
    .insert(schema.jobs)
    .values({
      kind: input.kind,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      run_at: input.runAt ?? now,
      created_at: now,
      updated_at: now,
    })
    .returning()

  return created!
}

/**
 * Claims the next due pending job of the given kind using
 * SELECT ... FOR UPDATE SKIP LOCKED inside a transaction.
 */
export async function claimNextJob(
  db: CloudDatabase,
  kind: string,
  now = new Date(),
): Promise<JobRow | undefined> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.kind, kind), eq(schema.jobs.status, "pending"), lte(schema.jobs.run_at, now)))
      .orderBy(asc(schema.jobs.run_at), asc(schema.jobs.created_at))
      .limit(1)
      .for("update", { skipLocked: true })

    if (!job) return undefined

    const [claimed] = await tx
      .update(schema.jobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        updated_at: now,
      })
      .where(eq(schema.jobs.id, job.id))
      .returning()

    return claimed
  })
}

import { and, desc, eq, gt, lt, sql } from "drizzle-orm"
import type { CloudDatabase } from "./db/index.js"
import { schema } from "./db/schema.js"

export const CREDIT_LEDGER_REASONS = [
  "purchase",
  "session_grade",
  "assessment",
  "refund",
  "admin_grant",
] as const

export type CreditLedgerReason = (typeof CREDIT_LEDGER_REASONS)[number]

export type DbExecutor = Pick<CloudDatabase, "select" | "insert" | "update" | "execute">

export interface CreditLedgerRow {
  readonly id: string
  readonly user_id: string
  readonly amount: number
  readonly reason: CreditLedgerReason
  readonly reference_id: string | null
  readonly created_at: Date
}

export interface InsertCreditEntryInput {
  readonly userId: string
  readonly amount: number
  readonly reason: CreditLedgerReason
  readonly referenceId?: string | null
  readonly createdAt?: Date
}

function assertValidReason(reason: string): asserts reason is CreditLedgerReason {
  if (!(CREDIT_LEDGER_REASONS as readonly string[]).includes(reason)) {
    throw new RangeError(`Invalid credit ledger reason: ${reason}`)
  }
}

/**
 * Inserts a new row into the insert-only credit_ledger table.
 * Rows in credit_ledger are never updated or deleted.
 */
export async function insertCreditEntry(
  db: DbExecutor,
  input: InsertCreditEntryInput,
): Promise<CreditLedgerRow> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new RangeError(`Credit ledger amount must be a non-zero integer, got ${input.amount}`)
  }
  assertValidReason(input.reason)

  const [created] = await db
    .insert(schema.creditLedger)
    .values({
      user_id: input.userId,
      delta: input.amount,
      reason: input.reason,
      reference_id: input.referenceId ?? null,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    })
    .returning()

  return {
    id: created!.id,
    user_id: created!.user_id,
    amount: created!.delta,
    reason: created!.reason as CreditLedgerReason,
    reference_id: created!.reference_id,
    created_at: created!.created_at,
  }
}

export async function getCreditBalance(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int`,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.user_id, userId))

  return row?.balance ?? 0
}

export async function getCreditHistory(
  db: DbExecutor,
  userId: string,
  limit = 50,
): Promise<{ readonly balance: number; readonly ledger: readonly CreditLedgerRow[] }> {
  const [balance, rows] = await Promise.all([
    getCreditBalance(db, userId),
    db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.user_id, userId))
      .orderBy(desc(schema.creditLedger.created_at), desc(schema.creditLedger.id))
      .limit(limit),
  ])

  return {
    balance,
    ledger: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      amount: row.delta,
      reason: row.reason as CreditLedgerReason,
      reference_id: row.reference_id,
      created_at: row.created_at,
    })),
  }
}

async function refundInTx(
  tx: DbExecutor,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<{ readonly refunded: boolean; readonly amount: number }> {
  await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("update")

  const [chargeRow] = await tx
    .select()
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.user_id, userId),
        eq(schema.creditLedger.reason, "session_grade"),
        eq(schema.creditLedger.reference_id, sessionId),
        lt(schema.creditLedger.delta, 0),
      ),
    )

  if (!chargeRow) {
    return { refunded: false, amount: 0 }
  }

  const [existingRefund] = await tx
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.user_id, userId),
        eq(schema.creditLedger.reason, "refund"),
        eq(schema.creditLedger.reference_id, sessionId),
        gt(schema.creditLedger.delta, 0),
      ),
    )

  if (existingRefund) {
    return { refunded: false, amount: 0 }
  }

  const refundAmount = Math.abs(chargeRow.delta)
  await insertCreditEntry(tx, {
    userId,
    amount: refundAmount,
    reason: "refund",
    referenceId: sessionId,
    createdAt: now,
  })

  return { refunded: true, amount: refundAmount }
}

export async function refundSessionCreditIfCharged(
  db: CloudDatabase,
  sessionId: string,
  now = new Date(),
): Promise<{ readonly refunded: boolean; readonly amount: number }> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ user_id: schema.sessions.user_id })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))

    if (!session) {
      return { refunded: false, amount: 0 }
    }

    return refundInTx(tx, sessionId, session.user_id, now)
  })
}

/**
 * Marks a session as permanently failed and automatically refunds any credit
 * charged for grading it. Idempotent: repeated calls will never double-refund.
 */
export async function markSessionGradingFailed(
  db: CloudDatabase,
  sessionId: string,
  now = new Date(),
): Promise<{ readonly refunded: boolean; readonly amount: number }> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: schema.sessions.id, user_id: schema.sessions.user_id })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))

    if (!session) {
      return { refunded: false, amount: 0 }
    }

    await tx
      .update(schema.sessions)
      .set({ status: "failed" })
      .where(eq(schema.sessions.id, sessionId))

    return refundInTx(tx, sessionId, session.user_id, now)
  })
}

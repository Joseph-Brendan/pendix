import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const EXPECTED_S10_TABLES: Record<string, readonly string[]> = {
  users: ["id", "email", "display_name", "dob", "account_kind", "status", "country", "tz", "role", "created_at"],
  consents: ["id", "user_id", "kind", "version", "granted_at", "revoked_at"],
  guardians: ["id", "guardian_user_id", "email", "teen_user_id", "approved_at"],
  devices: ["id", "user_id", "token_hash", "revoked_at", "created_at"],
  sessions: ["id", "user_id", "source", "project_title", "model", "status", "tier", "graded_at", "created_at"],
  session_records: ["id", "session_id", "redacted_json", "created_at"],
  grades: ["id", "session_id", "prompt_index", "scores", "reasons", "total", "improved_prompt", "confidence", "model_used"],
  corrections: ["id", "grade_id", "reviewer_user_id", "scores", "feedback", "created_at"],
  session_notes: ["id", "session_id", "what_was_built", "learned", "to_work_on", "model_used"],
  understanding_scores: ["id", "session_id", "score", "reason", "model_used"],
  assessments: ["id", "user_id", "status", "total_score", "due_at", "created_at"],
  assessment_answers: ["id", "assessment_id", "question_index", "question_kind", "prompt", "answer", "score", "feedback"],
  credit_ledger: ["id", "user_id", "delta", "reason", "reference_id", "created_at"],
  payments: ["id", "user_id", "tx_ref", "flutterwave_tx_id", "flutterwave_flw_ref", "amount_cents", "currency", "status"],
  billing_plans: ["id", "plan", "period", "currency", "amount_cents", "flutterwave_plan_id"],
  subscriptions: ["id", "user_id", "group_id", "plan", "period", "status", "current_period_end"],
  groups: ["id", "owner_user_id", "name", "grade_visibility", "teach_lock", "created_at"],
  group_members: ["id", "group_id", "user_id", "role", "seat_plan", "joined_at"],
  group_invites: ["id", "group_id", "email", "role", "seat_plan", "expires_at", "accepted_at"],
  mentors: ["id", "user_id", "status", "capacity", "teen_badge", "rating", "stacks", "tz", "payout_details_encrypted"],
  mentor_applications: ["id", "user_id", "status", "id_document_key", "created_at"],
  mentor_tests: ["id", "user_id", "attempt", "exact_match_rate", "passed", "completed_at"],
  matches: ["id", "learner_user_id", "mentor_user_id", "status", "matched_at", "ended_at"],
  reviews: ["id", "match_id", "reviewer_user_id", "learner_user_id", "feedback", "due_at", "submitted_at"],
  messages: ["id", "thread_id", "sender_user_id", "recipient_user_id", "body", "created_at"],
  message_flags: ["id", "sender_user_id", "recipient_user_id", "reason", "resolved_at", "created_at"],
  feedback_files: ["id", "review_id", "uploader_user_id", "storage_key", "content_type", "size_bytes"],
  calls: ["id", "match_id", "requested_by_user_id", "guardian_attending", "status", "scheduled_for"],
  ratings: ["id", "match_id", "learner_user_id", "mentor_user_id", "score", "comment", "created_at"],
  earnings_ledger: ["id", "mentor_user_id", "delta_cents", "reason", "reference_id", "created_at"],
  payouts: ["id", "mentor_user_id", "amount_cents", "currency", "reference", "status", "approved_by_user_id", "paid_at"],
  skill_records: ["id", "user_id", "is_public", "public_slug", "guardian_approved_at", "visible_sections"],
  endorsements: ["id", "skill_record_id", "mentor_user_id", "body", "approved_at", "created_at"],
  jobs: ["id", "kind", "payload", "status", "attempts", "run_at", "created_at"],
  audit_log: ["id", "actor_user_id", "action", "target_type", "target_id", "before", "after", "created_at"],
}

describe("database migrations and S10 schema", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("applies migrations to an empty database and creates every S10 table and column", async () => {
    const rows = await testDb.sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = ${testDb.schemaName}
      ORDER BY table_name, ordinal_position
    `

    const columnsByTable = new Map<string, Set<string>>()
    for (const row of rows) {
      let cols = columnsByTable.get(row.table_name)
      if (!cols) {
        cols = new Set()
        columnsByTable.set(row.table_name, cols)
      }
      cols.add(row.column_name)
    }

    for (const [table, expectedColumns] of Object.entries(EXPECTED_S10_TABLES)) {
      const actualColumns = columnsByTable.get(table)
      expect(actualColumns, `missing table ${table}`).toBeDefined()
      for (const column of expectedColumns) {
        expect(actualColumns!.has(column), `missing column ${table}.${column}`).toBe(true)
      }
    }
  })
})

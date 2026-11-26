import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  email_verified: boolean("email_verified").notNull().default(false),
  display_name: text("display_name").notNull(),
  image: text("image"),
  dob: text("dob").notNull().default(""),
  account_kind: text("account_kind").notNull().default("pending"),
  status: text("status").notNull().default("pending_verification"),
  country: text("country").notNull().default(""),
  tz: text("tz").notNull().default("UTC"),
  role: text("role").notNull().default("learner"),
  teach_lock: text("teach_lock").notNull().default("none"),
  session_report_emails: boolean("session_report_emails").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
})

export const authAccounts = pgTable("auth_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  account_id: text("account_id").notNull(),
  provider_id: text("provider_id").notNull(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  id_token: text("id_token"),
  access_token_expires_at: timestamp("access_token_expires_at", { withTimezone: true }),
  refresh_token_expires_at: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  granted_at: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
})

export const guardians = pgTable("guardians", {
  id: uuid("id").defaultRandom().primaryKey(),
  guardian_user_id: uuid("guardian_user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  teen_user_id: uuid("teen_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token_hash: text("token_hash"),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const devices = pgTable("devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  token_hash: text("token_hash").notNull().unique(),
  refresh_token_hash: text("refresh_token_hash").unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  refresh_expires_at: timestamp("refresh_expires_at", { withTimezone: true }),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const deviceCodes = pgTable("device_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  device_code: text("device_code").notNull().unique(),
  user_code: text("user_code").notNull().unique(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  last_polled_at: timestamp("last_polled_at", { withTimezone: true }),
  polling_interval: integer("polling_interval"),
  client_id: text("client_id"),
  scope: text("scope"),
  device_name: text("device_name").notNull().default(""),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  project_title: text("project_title").notNull().default(""),
  model: text("model").notNull().default(""),
  status: text("status").notNull().default("uploaded"),
  tier: text("tier"),
  graded_at: timestamp("graded_at", { withTimezone: true }),
  report_emailed_at: timestamp("report_emailed_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const sessionRecords = pgTable("session_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  session_id: uuid("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  redacted_json: jsonb("redacted_json").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const grades = pgTable("grades", {
  id: uuid("id").defaultRandom().primaryKey(),
  session_id: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  prompt_index: integer("prompt_index").notNull(),
  scores: jsonb("scores").notNull(),
  reasons: jsonb("reasons").notNull(),
  total: integer("total").notNull(),
  improved_prompt: text("improved_prompt").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  model_used: text("model_used").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const corrections = pgTable("corrections", {
  id: uuid("id").defaultRandom().primaryKey(),
  grade_id: uuid("grade_id")
    .notNull()
    .references(() => grades.id, { onDelete: "cascade" }),
  reviewer_user_id: uuid("reviewer_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scores: jsonb("scores").notNull(),
  feedback: text("feedback").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const sessionNotes = pgTable("session_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  session_id: uuid("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  what_was_built: text("what_was_built").notNull(),
  learned: jsonb("learned").notNull(),
  to_work_on: jsonb("to_work_on").notNull(),
  summary: text("summary").notNull().default(""),
  model_used: text("model_used").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const understandingScores = pgTable("understanding_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  session_id: uuid("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  reason: text("reason").notNull(),
  model_used: text("model_used").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const assessments = pgTable("assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("available"),
  total_score: integer("total_score"),
  due_at: timestamp("due_at", { withTimezone: true }).notNull(),
  opened_at: timestamp("opened_at", { withTimezone: true }),
  submitted_at: timestamp("submitted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const assessmentAnswers = pgTable("assessment_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessment_id: uuid("assessment_id")
    .notNull()
    .references(() => assessments.id, { onDelete: "cascade" }),
  question_index: integer("question_index").notNull(),
  question_kind: text("question_kind").notNull(),
  prompt: text("prompt").notNull(),
  answer: text("answer"),
  score: integer("score"),
  feedback: text("feedback"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

// Insert-only ledger for grading/assessment credits.
export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  reference_id: text("reference_id"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tx_ref: text("tx_ref").notNull().unique(),
  flutterwave_tx_id: text("flutterwave_tx_id"),
  flutterwave_flw_ref: text("flutterwave_flw_ref"),
  amount_cents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const billingPlans = pgTable("billing_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  plan: text("plan").notNull(),
  period: text("period").notNull(),
  currency: text("currency").notNull().default("USD"),
  amount_cents: integer("amount_cents").notNull(),
  flutterwave_plan_id: text("flutterwave_plan_id"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  owner_user_id: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  grade_visibility: text("grade_visibility").notNull().default("owner_and_member"),
  teach_lock: text("teach_lock").notNull().default("none"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  group_id: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  plan: text("plan").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull().default("active"),
  current_period_end: timestamp("current_period_end", { withTimezone: true }).notNull(),
  grace_until: timestamp("grace_until", { withTimezone: true }),
  cancel_at_period_end: boolean("cancel_at_period_end").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    group_id: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    seat_plan: text("seat_plan"),
    joined_at: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("group_members_group_user_idx").on(table.group_id, table.user_id)],
)

export const groupInvites = pgTable("group_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  group_id: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  seat_plan: text("seat_plan"),
  token_hash: text("token_hash"),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  accepted_at: timestamp("accepted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const mentors = pgTable("mentors", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("applied"),
  capacity: integer("capacity").notNull().default(5),
  teen_badge: boolean("teen_badge").notNull().default(false),
  rating: doublePrecision("rating"),
  stacks: jsonb("stacks").notNull().default([]),
  tz: text("tz").notNull().default("UTC"),
  payout_details_encrypted: text("payout_details_encrypted"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const mentorApplications = pgTable("mentor_applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("applied"),
  id_document_key: text("id_document_key"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const mentorTests = pgTable("mentor_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull().default(1),
  exact_match_rate: doublePrecision("exact_match_rate").notNull(),
  passed: boolean("passed").notNull(),
  completed_at: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
})

export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  learner_user_id: uuid("learner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mentor_user_id: uuid("mentor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  matched_at: timestamp("matched_at", { withTimezone: true }).defaultNow().notNull(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
})

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  match_id: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  reviewer_user_id: uuid("reviewer_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  learner_user_id: uuid("learner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  feedback: text("feedback").notNull().default(""),
  due_at: timestamp("due_at", { withTimezone: true }).notNull(),
  submitted_at: timestamp("submitted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  thread_id: uuid("thread_id").notNull(),
  sender_user_id: uuid("sender_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recipient_user_id: uuid("recipient_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const messageFlags = pgTable("message_flags", {
  id: uuid("id").defaultRandom().primaryKey(),
  sender_user_id: uuid("sender_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recipient_user_id: uuid("recipient_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const feedbackFiles = pgTable("feedback_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  review_id: uuid("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  uploader_user_id: uuid("uploader_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  storage_key: text("storage_key").notNull(),
  content_type: text("content_type").notNull(),
  size_bytes: integer("size_bytes").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  match_id: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  requested_by_user_id: uuid("requested_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  guardian_attending: boolean("guardian_attending").notNull().default(false),
  status: text("status").notNull().default("requested"),
  scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const ratings = pgTable("ratings", {
  id: uuid("id").defaultRandom().primaryKey(),
  match_id: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  learner_user_id: uuid("learner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mentor_user_id: uuid("mentor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  comment: text("comment"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

// Insert-only ledger for mentor earnings (integer cents).
export const earningsLedger = pgTable("earnings_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  mentor_user_id: uuid("mentor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  delta_cents: integer("delta_cents").notNull(),
  reason: text("reason").notNull(),
  reference_id: text("reference_id"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const payouts = pgTable("payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  mentor_user_id: uuid("mentor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount_cents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  reference: text("reference").notNull().unique(),
  status: text("status").notNull().default("pending"),
  approved_by_user_id: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  paid_at: timestamp("paid_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const skillRecords = pgTable("skill_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  is_public: boolean("is_public").notNull().default(false),
  public_slug: text("public_slug").unique(),
  guardian_approved_at: timestamp("guardian_approved_at", { withTimezone: true }),
  visible_sections: jsonb("visible_sections").notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const endorsements = pgTable("endorsements", {
  id: uuid("id").defaultRandom().primaryKey(),
  skill_record_id: uuid("skill_record_id")
    .notNull()
    .references(() => skillRecords.id, { onDelete: "cascade" }),
  mentor_user_id: uuid("mentor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  last_error: text("last_error"),
  run_at: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor_user_id: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const schema = {
  users,
  authSessions,
  authAccounts,
  authVerifications,
  consents,
  guardians,
  devices,
  deviceCodes,
  sessions,
  sessionRecords,
  grades,
  corrections,
  sessionNotes,
  understandingScores,
  assessments,
  assessmentAnswers,
  creditLedger,
  payments,
  billingPlans,
  groups,
  subscriptions,
  groupMembers,
  groupInvites,
  mentors,
  mentorApplications,
  mentorTests,
  matches,
  reviews,
  messages,
  messageFlags,
  feedbackFiles,
  calls,
  ratings,
  earningsLedger,
  payouts,
  skillRecords,
  endorsements,
  jobs,
  auditLog,
}

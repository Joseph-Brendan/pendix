import type { AccountKind } from "./age.js"
import type { GraderTier } from "./models.js"
import type { BillingPeriod, PlanId } from "./plans.js"
import type { PromptReasons, PromptScores } from "./rubric.js"

export type StoredAccountKind = Exclude<AccountKind, "blocked">
export type UserStatus = "pending_verification" | "pending_guardian" | "active" | "paused" | "closed"
export type UserRole = "learner" | "mentor" | "guardian" | "admin"
export type SessionSource = "terminal" | "claude-code" | "codex" | "other"
export type SessionStatus = "recording" | "uploaded" | "queued" | "graded" | "failed"
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded"
export type SubscriptionStatus = "active" | "grace" | "cancelled" | "expired"
export type GroupRole = "owner" | "instructor" | "member"
export type GradeVisibility = "owner_only" | "owner_and_member" | "member_decides"
export type TeachLock = "none" | "self" | "class"
export type MentorStatus = "applied" | "testing" | "interview" | "probation" | "active" | "paused" | "rejected"
export type MatchStatus = "active" | "rematched" | "ended"
export type AssessmentStatus = "available" | "opened" | "submitted" | "graded" | "expired"
export type PayoutStatus = "pending" | "approved" | "paid" | "failed"
export type JobStatus = "pending" | "running" | "completed" | "failed"
export type CallStatus = "requested" | "scheduled" | "completed" | "cancelled"

export interface User {
  readonly id: string
  readonly email: string
  readonly display_name: string
  readonly dob: string
  readonly account_kind: StoredAccountKind
  readonly status: UserStatus
  readonly country: string
  readonly tz: string
  readonly role: UserRole
  readonly created_at: string
}

export interface Consent {
  readonly id: string
  readonly user_id: string
  readonly kind: "terms" | "privacy" | "grading" | "guardian"
  readonly version: string
  readonly granted_at: string
  readonly revoked_at: string | null
}

export interface Guardian {
  readonly id: string
  readonly guardian_user_id: string | null
  readonly email: string
  readonly teen_user_id: string
  readonly approved_at: string | null
}

export interface Device {
  readonly id: string
  readonly user_id: string
  readonly name: string
  readonly token_hash: string
  readonly last_used_at: string | null
  readonly revoked_at: string | null
  readonly created_at: string
}

export interface Session {
  readonly id: string
  readonly user_id: string
  readonly source: SessionSource
  readonly project_title: string
  readonly model: string
  readonly status: SessionStatus
  readonly tier: GraderTier | null
  readonly graded_at: string | null
  readonly created_at: string
}

export interface SessionRecord {
  readonly id: string
  readonly session_id: string
  readonly redacted_json: Record<string, unknown>
  readonly created_at: string
}

export interface Grade {
  readonly id: string
  readonly session_id: string
  readonly prompt_index: number
  readonly scores: PromptScores
  readonly reasons: PromptReasons
  readonly total: number
  readonly improved_prompt: string
  readonly confidence: number
  readonly model_used: string
  readonly created_at: string
}

export interface Correction {
  readonly id: string
  readonly grade_id: string
  readonly reviewer_user_id: string
  readonly scores: PromptScores
  readonly feedback: string
  readonly created_at: string
}

export interface SessionNote {
  readonly id: string
  readonly session_id: string
  readonly what_was_built: string
  readonly learned: readonly string[]
  readonly to_work_on: readonly string[]
  readonly model_used: string
  readonly created_at: string
}

export interface UnderstandingScoreRecord {
  readonly id: string
  readonly session_id: string
  readonly score: number
  readonly reason: string
  readonly model_used: string
  readonly created_at: string
}

export interface Assessment {
  readonly id: string
  readonly user_id: string
  readonly status: AssessmentStatus
  readonly total_score: number | null
  readonly due_at: string
  readonly opened_at: string | null
  readonly submitted_at: string | null
  readonly created_at: string
}

export interface AssessmentAnswer {
  readonly id: string
  readonly assessment_id: string
  readonly question_index: number
  readonly question_kind: "why" | "what_would_break" | "how_to_check" | "multiple_choice"
  readonly prompt: string
  readonly answer: string | null
  readonly score: number | null
  readonly feedback: string | null
}

export interface CreditLedgerEntry {
  readonly id: string
  readonly user_id: string
  readonly delta: number
  readonly reason: string
  readonly reference_id: string | null
  readonly created_at: string
}

export interface Payment {
  readonly id: string
  readonly user_id: string
  readonly tx_ref: string
  readonly flutterwave_tx_id: string | null
  readonly flutterwave_flw_ref: string | null
  readonly amount_cents: number
  readonly currency: string
  readonly status: PaymentStatus
  readonly created_at: string
}

export interface BillingPlanRecord {
  readonly id: string
  readonly plan: PlanId
  readonly period: BillingPeriod
  readonly currency: string
  readonly amount_cents: number
  readonly flutterwave_plan_id: string | null
}

export interface Subscription {
  readonly id: string
  readonly user_id: string
  readonly group_id: string | null
  readonly plan: PlanId
  readonly period: BillingPeriod
  readonly status: SubscriptionStatus
  readonly current_period_end: string
  readonly grace_until: string | null
  readonly cancel_at_period_end: boolean
}

export interface Group {
  readonly id: string
  readonly owner_user_id: string
  readonly name: string
  readonly grade_visibility: GradeVisibility
  readonly teach_lock: TeachLock
  readonly created_at: string
}

export interface GroupMember {
  readonly id: string
  readonly group_id: string
  readonly user_id: string
  readonly role: GroupRole
  readonly seat_plan: Exclude<PlanId, "free"> | null
  readonly joined_at: string
}

export interface GroupInvite {
  readonly id: string
  readonly group_id: string
  readonly email: string
  readonly role: GroupRole
  readonly seat_plan: Exclude<PlanId, "free"> | null
  readonly expires_at: string
  readonly accepted_at: string | null
}

export interface Mentor {
  readonly id: string
  readonly user_id: string
  readonly status: MentorStatus
  readonly capacity: number
  readonly teen_badge: boolean
  readonly rating: number | null
  readonly stacks: readonly string[]
  readonly tz: string
  readonly payout_details_encrypted: string | null
}

export interface MentorApplication {
  readonly id: string
  readonly user_id: string
  readonly status: MentorStatus
  readonly id_document_key: string | null
  readonly created_at: string
}

export interface MentorTest {
  readonly id: string
  readonly user_id: string
  readonly attempt: number
  readonly exact_match_rate: number
  readonly passed: boolean
  readonly completed_at: string
}

export interface Match {
  readonly id: string
  readonly learner_user_id: string
  readonly mentor_user_id: string
  readonly status: MatchStatus
  readonly matched_at: string
  readonly ended_at: string | null
}

export interface Review {
  readonly id: string
  readonly match_id: string
  readonly reviewer_user_id: string
  readonly learner_user_id: string
  readonly feedback: string
  readonly due_at: string
  readonly submitted_at: string | null
}

export interface Message {
  readonly id: string
  readonly thread_id: string
  readonly sender_user_id: string
  readonly recipient_user_id: string
  readonly body: string
  readonly created_at: string
}

export interface MessageFlag {
  readonly id: string
  readonly sender_user_id: string
  readonly recipient_user_id: string
  readonly reason: string
  readonly resolved_at: string | null
  readonly created_at: string
}

export interface FeedbackFile {
  readonly id: string
  readonly review_id: string
  readonly uploader_user_id: string
  readonly storage_key: string
  readonly content_type: string
  readonly size_bytes: number
  readonly created_at: string
}

export interface Call {
  readonly id: string
  readonly match_id: string
  readonly requested_by_user_id: string
  readonly guardian_attending: boolean
  readonly status: CallStatus
  readonly scheduled_for: string | null
  readonly created_at: string
}

export interface Rating {
  readonly id: string
  readonly match_id: string
  readonly learner_user_id: string
  readonly mentor_user_id: string
  readonly score: number
  readonly comment: string | null
  readonly created_at: string
}

export interface EarningsLedgerEntry {
  readonly id: string
  readonly mentor_user_id: string
  readonly delta_cents: number
  readonly reason: string
  readonly reference_id: string | null
  readonly created_at: string
}

export interface Payout {
  readonly id: string
  readonly mentor_user_id: string
  readonly amount_cents: number
  readonly currency: string
  readonly reference: string
  readonly status: PayoutStatus
  readonly approved_by_user_id: string | null
  readonly paid_at: string | null
  readonly created_at: string
}

export interface SkillRecord {
  readonly id: string
  readonly user_id: string
  readonly is_public: boolean
  readonly public_slug: string | null
  readonly guardian_approved_at: string | null
  readonly visible_sections: readonly string[]
}

export interface Endorsement {
  readonly id: string
  readonly skill_record_id: string
  readonly mentor_user_id: string
  readonly body: string
  readonly approved_at: string | null
  readonly created_at: string
}

export interface Job {
  readonly id: string
  readonly kind: string
  readonly payload: Record<string, unknown>
  readonly status: JobStatus
  readonly attempts: number
  readonly run_at: string
  readonly created_at: string
}

export interface AuditLogEntry {
  readonly id: string
  readonly actor_user_id: string
  readonly action: string
  readonly target_type: string
  readonly target_id: string
  readonly before: Record<string, unknown> | null
  readonly after: Record<string, unknown> | null
  readonly created_at: string
}

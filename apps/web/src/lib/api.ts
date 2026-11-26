import type { PromptReasons, PromptScores } from "@pendix/shared/rubric"

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "/pendix-api" : "http://127.0.0.1:3001")

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiClientError"
    this.status = status
    this.code = code
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  })

  const text = await res.text()
  let parsed: unknown = null
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!res.ok) {
    const errObj =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? (parsed as { error?: { code?: string; message?: string } }).error
        : undefined
    const msg =
      errObj?.message ||
      (typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Request failed (${res.status})`)
    throw new ApiClientError(res.status, errObj?.code ?? "REQUEST_FAILED", msg)
  }

  return parsed as T
}

export interface MeResponse {
  readonly id: string
  readonly display_name: string
  readonly email: string
  readonly account_kind: "adult" | "teen" | "pending"
  readonly status: string
  readonly plan: "free" | "solo" | "mentored"
  readonly credits: number
  readonly teach_lock: "none" | "self" | "class"
}

export interface ProfileResponse {
  readonly display_name: string
  readonly email: string
  readonly tz: string
  readonly session_report_emails: boolean
  readonly grading_consent: boolean
  readonly teach_lock: "none" | "self" | "class"
  readonly period_end: string | null
  readonly fair_use_remaining: number
  readonly graded_sessions_this_month: number
  readonly has_mentor: boolean
}

export interface DeviceVerifyInfo {
  readonly user_code: string | null
  readonly formatted_code: string | null
  readonly found: boolean
  readonly device_name: string | null
  readonly status: string | null
  readonly viewer: {
    readonly display_name: string
    readonly status: string
    readonly can_approve: boolean
    readonly blocked_reason: string | null
  } | null
}

export interface GuardianApprovalInfo {
  readonly teen_display_name: string
  readonly about_pendix: string
  readonly guardian_consent_version: string
  readonly expires_at: string | null
}

export interface SessionSummary {
  readonly id: string
  readonly project_title: string
  readonly model: string
  readonly source?: string
  readonly status: string
  readonly created_at: string
  readonly graded_at: string | null
  readonly score: number | null
  readonly understanding_score: number | null
  readonly report_emailed?: boolean
}

export interface DashboardTrendWeek {
  readonly week_start: string
  readonly prompt_score: number | null
  readonly understanding_score: number | null
  readonly sessions: number
}

export interface DashboardResponse {
  readonly this_week: {
    readonly prompt_score: number | null
    readonly understanding_score: number | null
    readonly graded_sessions: number
  }
  readonly trend: readonly DashboardTrendWeek[]
  readonly recent_sessions: readonly SessionSummary[]
  readonly assessment_due: {
    readonly id: string
    readonly status: string
    readonly due_at: string
    readonly week_key: string | null
  } | null
  readonly mentor: {
    readonly display_name: string
    readonly tz: string
    readonly matched_at: string
  } | null
}

export interface SessionDetailPrompt {
  readonly id: string
  readonly prompt_index: number
  readonly text: string
  readonly scores: PromptScores
  readonly reasons: PromptReasons
  readonly total: number
  readonly improved_prompt: string
  readonly confidence: number
  readonly model_used: string
  readonly disputed: boolean
}

export interface SessionDetailResponse {
  readonly session: SessionSummary
  readonly prompts: readonly SessionDetailPrompt[]
  readonly understanding: {
    readonly score: number
    readonly reason: string
    readonly model_used: string
  } | null
  readonly notes: {
    readonly what_was_built: string
    readonly learned: readonly string[]
    readonly to_work_on: readonly string[]
    readonly summary: string
    readonly model_used: string
  } | null
  readonly model_used: string | null
}

export interface AssessmentSummary {
  readonly id: string
  readonly user_id: string
  readonly week_key: string | null
  readonly status: string
  readonly total_score: number | null
  readonly is_late: boolean
  readonly model_used: string | null
  readonly due_at: string
  readonly opened_at: string | null
  readonly submitted_at: string | null
  readonly created_at: string
}

export interface AssessmentQuestionItem {
  readonly question_index: number
  readonly question_kind: "why" | "what_would_break" | "how_to_check" | "multiple_choice"
  readonly reference_target: string
  readonly prompt: string
  readonly choices?: readonly string[]
  readonly answer: string | null
  readonly score: number | null
  readonly feedback: string | null
}

export interface AssessmentDetailResponse {
  readonly assessment: AssessmentSummary & {
    readonly requires_confirmation?: boolean
    readonly credit_cost?: number
    readonly credit_balance?: number
  }
  readonly questions: readonly AssessmentQuestionItem[]
}

export interface CreditLedgerItem {
  readonly id: string
  readonly amount: number
  readonly reason: string
  readonly reference_id: string | null
  readonly created_at: string
}

export interface CreditsHistoryResponse {
  readonly balance: number
  readonly ledger: readonly CreditLedgerItem[]
}

export interface BillingReceipt {
  readonly id: string
  readonly kind: string
  readonly tx_ref: string
  readonly amount_cents: number
  readonly currency: string
  readonly status: string
  readonly paid_at: string | null
  readonly created_at: string
}

export interface BillingSummaryResponse {
  readonly subscription: {
    readonly id: string
    readonly plan: string
    readonly period: string
    readonly status: string
    readonly currency: string
    readonly current_period_end: string
    readonly cancel_at_period_end: boolean
  } | null
  readonly receipts: readonly BillingReceipt[]
}

export interface DeviceItem {
  readonly id: string
  readonly name: string
  readonly last_used_at: string | null
  readonly expires_at: string | null
  readonly created_at: string
}

export function formatMoney(cents: number, currency = "USD"): string {
  const major = cents / 100
  if (currency.toUpperCase() === "NGN") {
    return `NGN ${major.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }
  return `$${major % 1 === 0 ? major.toFixed(0) : major.toFixed(2)}`
}

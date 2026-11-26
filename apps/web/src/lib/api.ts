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

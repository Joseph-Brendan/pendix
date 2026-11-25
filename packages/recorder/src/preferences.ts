import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"

export const MAX_RECORD_BYTES = 2 * 1024 * 1024 // 2 MB (SPEC S12)
export const LOCAL_RETENTION_AFTER_UPLOAD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days (SPEC S12)
export const GRADING_CONSENT_VERSION = "2026-01"

export const GRADING_CONSENT_COPY = [
  "Grading consent",
  "",
  "What is sent when a session is graded:",
  "- Your redacted prompts and teach mode questions and answers.",
  "- Turn summaries: tool names and counts, command names only, and relative file paths with line counts.",
  "- Model name, timings, and the first 500 characters of replies.",
  "",
  "What is never sent:",
  "- File contents or source code.",
  "- Environment values, command arguments, passwords, or API keys.",
].join("\n")

export interface GradingConsentState {
  readonly granted: boolean
  readonly version: string
  readonly granted_at: string
  readonly synced?: boolean
}

export interface QueuedSessionUpload {
  readonly local_session_id: string
  readonly project_key: string
  readonly project_dir?: string
  readonly queued_at: string
  readonly attempts: number
  readonly skip_client_redaction?: boolean
}

export interface UploadedSessionMeta {
  readonly remote_id: string
  readonly uploaded_at: string
  readonly status: "queued" | "uploaded" | "graded"
  readonly project_name?: string
  readonly score?: number | null
}

export interface RecorderState {
  readonly grading_consent?: GradingConsentState
  readonly always_grade_projects: Readonly<Record<string, boolean>>
  readonly last_free_nudge_date?: string
  readonly upload_queue: readonly QueuedSessionUpload[]
  readonly uploaded_sessions: Readonly<Record<string, UploadedSessionMeta>>
}

export interface RecorderStateStore {
  readonly filePath: string
  load(): RecorderState
  save(state: RecorderState): void
}

function defaultState(): RecorderState {
  return {
    always_grade_projects: {},
    upload_queue: [],
    uploaded_sessions: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseState(raw: string): RecorderState {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return defaultState()

    const rawConsent = parsed.grading_consent
    const grading_consent =
      isRecord(rawConsent) &&
      typeof rawConsent.granted === "boolean" &&
      typeof rawConsent.version === "string" &&
      typeof rawConsent.granted_at === "string"
        ? {
            granted: rawConsent.granted,
            version: rawConsent.version,
            granted_at: rawConsent.granted_at,
            synced: typeof rawConsent.synced === "boolean" ? rawConsent.synced : undefined,
          }
        : undefined

    const always_grade_projects: Record<string, boolean> = {}
    if (isRecord(parsed.always_grade_projects)) {
      for (const [key, val] of Object.entries(parsed.always_grade_projects)) {
        if (val === true) always_grade_projects[key] = true
      }
    }

    const upload_queue: QueuedSessionUpload[] = []
    if (Array.isArray(parsed.upload_queue)) {
      for (const item of parsed.upload_queue) {
        if (
          isRecord(item) &&
          typeof item.local_session_id === "string" &&
          typeof item.project_key === "string" &&
          typeof item.queued_at === "string"
        ) {
          upload_queue.push({
            local_session_id: item.local_session_id,
            project_key: item.project_key,
            project_dir: typeof item.project_dir === "string" ? item.project_dir : undefined,
            queued_at: item.queued_at,
            attempts: typeof item.attempts === "number" ? item.attempts : 0,
            skip_client_redaction: item.skip_client_redaction === true ? true : undefined,
          })
        }
      }
    }

    const uploaded_sessions: Record<string, UploadedSessionMeta> = {}
    if (isRecord(parsed.uploaded_sessions)) {
      for (const [key, item] of Object.entries(parsed.uploaded_sessions)) {
        if (isRecord(item) && typeof item.remote_id === "string" && typeof item.uploaded_at === "string") {
          const status =
            item.status === "graded" || item.status === "uploaded" || item.status === "queued"
              ? item.status
              : "uploaded"
          uploaded_sessions[key] = {
            remote_id: item.remote_id,
            uploaded_at: item.uploaded_at,
            status,
            project_name: typeof item.project_name === "string" ? item.project_name : undefined,
            score: typeof item.score === "number" ? item.score : null,
          }
        }
      }
    }

    return {
      grading_consent,
      always_grade_projects,
      last_free_nudge_date: typeof parsed.last_free_nudge_date === "string" ? parsed.last_free_nudge_date : undefined,
      upload_queue,
      uploaded_sessions,
    }
  } catch {
    return defaultState()
  }
}

export function createRecorderStateStore(dataDir: string): RecorderStateStore {
  const filePath = path.join(dataDir, "recorder-state.json")

  return {
    filePath,
    load() {
      if (!existsSync(filePath)) return defaultState()
      try {
        return parseState(readFileSync(filePath, "utf8"))
      } catch {
        return defaultState()
      }
    },
    save(state) {
      mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      if (process.platform !== "win32") chmodSync(tempPath, 0o600)
      renameSync(tempPath, filePath)
      if (process.platform !== "win32") chmodSync(filePath, 0o600)
    },
  }
}

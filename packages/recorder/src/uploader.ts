import { readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { CREDIT_COSTS, type PlanId } from "@pendix/shared/plans"
import { DEFAULT_PENDIX_WEB_URL } from "@pendix/shared/urls"
import {
  GRADING_CONSENT_COPY,
  GRADING_CONSENT_VERSION,
  LOCAL_RETENTION_AFTER_UPLOAD_MS,
  MAX_RECORD_BYTES,
  type QueuedSessionUpload,
  type RecorderStateStore,
} from "./preferences.js"
import { loadProjectEnvValues, redactSession } from "./redact.js"
import { sanitizeSessionId } from "./sanitize.js"
import type { RecorderRecord } from "./types.js"

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_BACKOFF_MS = 200

export interface UploadAccountInfo {
  readonly plan: PlanId
  readonly hasGroupSeat?: boolean
  readonly credits: number
  readonly entitlements: { readonly grading: boolean }
  readonly offline?: boolean
}

export type CreditPromptChoice = "yes" | "no" | "always"

export interface CreditPromptInfo {
  readonly credits: number
  readonly cost: number
  readonly projectKey: string
  readonly message: string
}

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface HandleSessionEndOptions {
  readonly sessionId: string
  readonly projectKey: string
  readonly projectDir?: string
  readonly dataDir: string
  readonly stateStore: RecorderStateStore
  readonly apiUrl: string
  readonly authToken?: string
  readonly account: UploadAccountInfo
  readonly now?: () => number
  readonly fetchFn?: FetchFn
  readonly sleep?: (ms: number) => Promise<void>
  readonly write?: (text: string) => void
  readonly promptConsent?: (copy: string) => Promise<boolean>
  readonly promptCreditChoice?: (info: CreditPromptInfo) => Promise<CreditPromptChoice>
  readonly maxRetries?: number
  readonly baseBackoffMs?: number
  readonly skipClientRedaction?: boolean
}

export type HandleSessionEndResult =
  | { readonly action: "uploaded"; readonly remoteId: string }
  | { readonly action: "queued" }
  | { readonly action: "nudged" }
  | { readonly action: "skipped_free" }
  | { readonly action: "declined_credit" }
  | { readonly action: "declined_consent" }
  | { readonly action: "rejected"; readonly status: number; readonly message: string }

export interface DrainQueueOptions {
  readonly dataDir: string
  readonly stateStore: RecorderStateStore
  readonly apiUrl: string
  readonly authToken?: string
  readonly now?: () => number
  readonly fetchFn?: FetchFn
  readonly sleep?: (ms: number) => Promise<void>
  readonly maxRetries?: number
  readonly baseBackoffMs?: number
}

export interface DrainQueueResult {
  readonly uploaded: number
  readonly remaining: number
  readonly deletedLocalFiles: number
}

export interface LocalSessionSummary {
  readonly sessionId: string
  readonly projectName: string
  readonly time: string
  readonly status: "local" | "uploaded" | "graded"
  readonly remoteId?: string
  readonly score?: number | null
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function sessionFilePath(dataDir: string, sessionId: string): string {
  return path.join(dataDir, "sessions", `${sanitizeSessionId(sessionId)}.jsonl`)
}

export async function readSessionRecords(filePath: string): Promise<RecorderRecord[]> {
  const raw = await readFile(filePath, "utf8")
  const records: RecorderRecord[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed) && typeof parsed.type === "string") {
      records.push(parsed as unknown as RecorderRecord)
    }
  }
  return records
}

function isSubscriber(account: UploadAccountInfo): boolean {
  return (
    account.plan === "solo" ||
    account.plan === "mentored" ||
    account.hasGroupSeat === true ||
    account.entitlements.grading === true
  )
}

async function syncConsentIfNeeded(options: {
  readonly stateStore: RecorderStateStore
  readonly apiUrl: string
  readonly authToken: string
  readonly fetchFn: FetchFn
}): Promise<boolean> {
  const state = options.stateStore.load()
  const consent = state.grading_consent
  if (!consent?.granted) return false
  if (consent.synced) return true

  try {
    const response = await options.fetchFn(`${options.apiUrl}/consents/grading`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ granted: true, version: consent.version }),
    })
    if (response.ok) {
      options.stateStore.save({
        ...state,
        grading_consent: { ...consent, synced: true },
      })
      return true
    }
    return false
  } catch {
    return false
  }
}

async function uploadSingleItem(
  item: QueuedSessionUpload,
  options: {
    readonly dataDir: string
    readonly stateStore: RecorderStateStore
    readonly apiUrl: string
    readonly authToken: string
    readonly now: () => number
    readonly fetchFn: FetchFn
    readonly sleep: (ms: number) => Promise<void>
    readonly maxRetries: number
    readonly baseBackoffMs: number
  },
): Promise<
  | { readonly outcome: "uploaded"; readonly remoteId: string; readonly projectName?: string }
  | { readonly outcome: "retry_later" }
  | { readonly outcome: "drop"; readonly status: number; readonly message: string }
> {
  const filePath = sessionFilePath(options.dataDir, item.local_session_id)
  let rawRecords: RecorderRecord[]
  try {
    rawRecords = await readSessionRecords(filePath)
  } catch {
    return { outcome: "drop", status: 404, message: "Local session file not found." }
  }
  if (rawRecords.length === 0) {
    return { outcome: "drop", status: 400, message: "Session file is empty." }
  }

  let records = rawRecords
  if (!item.skip_client_redaction) {
    const envValues = item.project_dir ? await loadProjectEnvValues(item.project_dir) : []
    records = [...redactSession(rawRecords, { envValues }).records]
  }

  const startRecord = records.find((r) => r.type === "start")
  const projectTitle = startRecord?.type === "start" ? startRecord.project_name : item.project_key
  const model = startRecord?.type === "start" ? startRecord.model : ""

  const payload = JSON.stringify({
    source: "terminal",
    local_session_id: item.local_session_id,
    project_title: projectTitle,
    model,
    records,
  })

  if (Buffer.byteLength(payload, "utf8") > MAX_RECORD_BYTES) {
    return { outcome: "drop", status: 413, message: "Session record exceeds the 2 MB limit." }
  }

  const synced = await syncConsentIfNeeded({
    stateStore: options.stateStore,
    apiUrl: options.apiUrl,
    authToken: options.authToken,
    fetchFn: options.fetchFn,
  })
  if (!synced) {
    return { outcome: "retry_later" }
  }

  for (let attempt = 0; attempt < options.maxRetries; attempt += 1) {
    try {
      const response = await options.fetchFn(`${options.apiUrl}/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.authToken}`,
          "content-type": "application/json",
        },
        body: payload,
      })

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string }
        return {
          outcome: "uploaded",
          remoteId: typeof body.id === "string" ? body.id : item.local_session_id,
          projectName: projectTitle,
        }
      }

      // Permanent client rejections (400, 403, 413) should not retry forever.
      if (response.status === 400 || response.status === 403 || response.status === 413) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        return {
          outcome: "drop",
          status: response.status,
          message: body.error?.message ?? `Upload rejected with status ${response.status}.`,
        }
      }
    } catch {
      // Network error -> retry with backoff.
    }

    if (attempt + 1 < options.maxRetries) {
      await options.sleep(options.baseBackoffMs * Math.pow(3, attempt))
    }
  }

  return { outcome: "retry_later" }
}

export async function handleSessionEnd(options: HandleSessionEndOptions): Promise<HandleSessionEndResult> {
  const now = options.now ?? (() => Date.now())
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS

  const subscriber = isSubscriber(options.account)
  const creditCost = CREDIT_COSTS.sessionGrade
  const hasCredits = !subscriber && options.account.credits >= creditCost

  // 1. Free user with no credits: nudge at most once a day, never upload.
  if (!subscriber && !hasCredits) {
    const state = options.stateStore.load()
    const today = isoDate(now())
    if (state.last_free_nudge_date === today) {
      return { action: "skipped_free" }
    }
    options.stateStore.save({
      ...state,
      last_free_nudge_date: today,
    })
    write(`Get this session graded: buy credits or subscribe at ${DEFAULT_PENDIX_WEB_URL}/billing\n`)
    return { action: "nudged" }
  }

  // 2. Credit holder: ask unless "Always for this project" was previously chosen.
  if (hasCredits) {
    const state = options.stateStore.load()
    if (!state.always_grade_projects[options.projectKey]) {
      const message = `Grade this session? Uses ${creditCost} credit. You have ${options.account.credits}.`
      const choice = options.promptCreditChoice
        ? await options.promptCreditChoice({
            credits: options.account.credits,
            cost: creditCost,
            projectKey: options.projectKey,
            message,
          })
        : "no"
      if (choice === "no") {
        return { action: "declined_credit" }
      }
      if (choice === "always") {
        options.stateStore.save({
          ...state,
          always_grade_projects: {
            ...state.always_grade_projects,
            [options.projectKey]: true,
          },
        })
      }
    }
  }

  // 3. First-time grading consent: explain what is sent and what is never sent.
  let state = options.stateStore.load()
  if (!state.grading_consent?.granted) {
    const accepted = options.promptConsent ? await options.promptConsent(GRADING_CONSENT_COPY) : false
    if (!accepted) {
      return { action: "declined_consent" }
    }
    state = {
      ...state,
      grading_consent: {
        granted: true,
        version: GRADING_CONSENT_VERSION,
        granted_at: new Date(now()).toISOString(),
        synced: false,
      },
    }
    options.stateStore.save(state)
  }

  // 4. Persist to durable upload queue first so crashes/offline never lose the session.
  const queuedItem: QueuedSessionUpload = {
    local_session_id: options.sessionId,
    project_key: options.projectKey,
    project_dir: options.projectDir,
    queued_at: new Date(now()).toISOString(),
    attempts: 0,
    skip_client_redaction: options.skipClientRedaction ? true : undefined,
  }
  const alreadyQueued = state.upload_queue.some((item) => item.local_session_id === options.sessionId)
  if (!alreadyQueued) {
    state = {
      ...state,
      upload_queue: [...state.upload_queue, queuedItem],
    }
    options.stateStore.save(state)
  }

  if (options.account.offline || !options.authToken) {
    return { action: "queued" }
  }

  // 5. Attempt immediate upload with retries and exponential backoff.
  const result = await uploadSingleItem(queuedItem, {
    dataDir: options.dataDir,
    stateStore: options.stateStore,
    apiUrl: options.apiUrl,
    authToken: options.authToken,
    now,
    fetchFn,
    sleep,
    maxRetries,
    baseBackoffMs,
  })

  const latest = options.stateStore.load()
  if (result.outcome === "uploaded") {
    options.stateStore.save({
      ...latest,
      upload_queue: latest.upload_queue.filter((item) => item.local_session_id !== options.sessionId),
      uploaded_sessions: {
        ...latest.uploaded_sessions,
        [options.sessionId]: {
          remote_id: result.remoteId,
          uploaded_at: new Date(now()).toISOString(),
          status: "queued",
          project_name: result.projectName,
        },
      },
    })
    return { action: "uploaded", remoteId: result.remoteId }
  }

  if (result.outcome === "drop") {
    options.stateStore.save({
      ...latest,
      upload_queue: latest.upload_queue.filter((item) => item.local_session_id !== options.sessionId),
    })
    return { action: "rejected", status: result.status, message: result.message }
  }

  options.stateStore.save({
    ...latest,
    upload_queue: latest.upload_queue.map((item) =>
      item.local_session_id === options.sessionId ? { ...item, attempts: item.attempts + 1 } : item,
    ),
  })
  return { action: "queued" }
}

export async function cleanupOldLocalRecords(
  dataDir: string,
  stateStore: RecorderStateStore,
  nowMs: number,
): Promise<number> {
  const state = stateStore.load()
  let deleted = 0

  for (const [localSessionId, meta] of Object.entries(state.uploaded_sessions)) {
    const uploadedMs = Date.parse(meta.uploaded_at)
    if (!Number.isFinite(uploadedMs)) continue
    if (nowMs - uploadedMs < LOCAL_RETENTION_AFTER_UPLOAD_MS) continue
    const filePath = sessionFilePath(dataDir, localSessionId)
    try {
      await rm(filePath)
      deleted += 1
    } catch {
      // Already deleted or missing.
    }
  }

  return deleted
}

export async function drainUploadQueue(options: DrainQueueOptions): Promise<DrainQueueResult> {
  const now = options.now ?? (() => Date.now())
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS

  let uploaded = 0
  if (options.authToken) {
    const initialQueue = [...options.stateStore.load().upload_queue]
    for (const item of initialQueue) {
      const result = await uploadSingleItem(item, {
        dataDir: options.dataDir,
        stateStore: options.stateStore,
        apiUrl: options.apiUrl,
        authToken: options.authToken,
        now,
        fetchFn,
        sleep,
        maxRetries,
        baseBackoffMs,
      })

      const latest = options.stateStore.load()
      if (result.outcome === "uploaded") {
        uploaded += 1
        options.stateStore.save({
          ...latest,
          upload_queue: latest.upload_queue.filter((entry) => entry.local_session_id !== item.local_session_id),
          uploaded_sessions: {
            ...latest.uploaded_sessions,
            [item.local_session_id]: {
              remote_id: result.remoteId,
              uploaded_at: new Date(now()).toISOString(),
              status: "queued",
              project_name: result.projectName,
            },
          },
        })
      } else if (result.outcome === "drop") {
        options.stateStore.save({
          ...latest,
          upload_queue: latest.upload_queue.filter((entry) => entry.local_session_id !== item.local_session_id),
        })
      } else {
        options.stateStore.save({
          ...latest,
          upload_queue: latest.upload_queue.map((entry) =>
            entry.local_session_id === item.local_session_id ? { ...entry, attempts: entry.attempts + 1 } : entry,
          ),
        })
      }
    }
  }

  const deletedLocalFiles = await cleanupOldLocalRecords(options.dataDir, options.stateStore, now())
  const remaining = options.stateStore.load().upload_queue.length
  return { uploaded, remaining, deletedLocalFiles }
}

export async function listLocalSessions(
  dataDir: string,
  stateStore: RecorderStateStore,
): Promise<LocalSessionSummary[]> {
  const sessionsDir = path.join(dataDir, "sessions")
  let files: string[]
  try {
    files = (await readdir(sessionsDir)).filter((name) => name.endsWith(".jsonl"))
  } catch {
    return []
  }

  const state = stateStore.load()
  const summaries: LocalSessionSummary[] = []
  for (const name of files) {
    const filePath = path.join(sessionsDir, name)
    const fallbackId = name.slice(0, -".jsonl".length)
    try {
      const records = await readSessionRecords(filePath)
      const start = records.find((r) => r.type === "start")
      const sessionId = start?.type === "start" ? start.session_id : fallbackId
      const projectName = start?.type === "start" ? start.project_name : ""
      const time = start?.type === "start" ? start.time : ""
      const uploaded = state.uploaded_sessions[sessionId]
      summaries.push({
        sessionId,
        projectName,
        time,
        status: uploaded ? (uploaded.status === "graded" ? "graded" : "uploaded") : "local",
        remoteId: uploaded?.remote_id,
        score: uploaded?.score ?? null,
      })
    } catch {
      // Skip unreadable session files.
    }
  }

  return summaries.sort((a, b) => b.time.localeCompare(a.time))
}

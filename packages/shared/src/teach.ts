import type { TeachLock } from "./types.js"

export const TEACH_MODE_FILE_NAME = "teach-mode.json"
export const TEACH_CLASS_LOCK_MESSAGE = "Teach mode is locked by your instructor"
export const TEACH_SELF_LOCK_MESSAGE = "Teach mode is locked. Unlock it from your dashboard."

export interface TeachModeState {
  readonly enabled: boolean
  readonly locked: boolean
  readonly lock: TeachLock
  readonly lockMessage?: string
}

export interface TeachModeToggleResult {
  readonly enabled: boolean
  readonly localEnabled: boolean
  readonly changed: boolean
  readonly locked: boolean
  readonly lock: TeachLock
  readonly message?: string
}

export function normalizeTeachLock(value: unknown): TeachLock {
  if (value === "class" || value === "self") return value
  return "none"
}

export function teachLockMessage(lock: TeachLock): string | undefined {
  if (lock === "class") return TEACH_CLASS_LOCK_MESSAGE
  if (lock === "self") return TEACH_SELF_LOCK_MESSAGE
  return undefined
}

export function resolveTeachMode(input: {
  readonly localEnabled: boolean
  readonly teachLock?: TeachLock | string | null
}): TeachModeState {
  const lock = normalizeTeachLock(input.teachLock)
  if (lock !== "none") {
    return {
      enabled: true,
      locked: true,
      lock,
      lockMessage: teachLockMessage(lock),
    }
  }
  return {
    enabled: Boolean(input.localEnabled),
    locked: false,
    lock: "none",
  }
}

export function toggleTeachMode(input: {
  readonly localEnabled: boolean
  readonly teachLock?: TeachLock | string | null
}): TeachModeToggleResult {
  const lock = normalizeTeachLock(input.teachLock)
  if (lock !== "none") {
    return {
      enabled: true,
      localEnabled: Boolean(input.localEnabled),
      changed: false,
      locked: true,
      lock,
      message: teachLockMessage(lock),
    }
  }
  const next = !input.localEnabled
  return {
    enabled: next,
    localEnabled: next,
    changed: true,
    locked: false,
    lock: "none",
  }
}

/**
 * Extracts a teach-mode understanding check question from an assistant reply.
 * Strips fenced code blocks and inline code so syntax such as ternary operators
 * or query strings is not misidentified as a check question.
 */
export function extractTeachCheckQuestion(reply: string): string | undefined {
  const withoutFences = reply.replace(/```[\s\S]*?```/g, "\n")
  const withoutInlineCode = withoutFences.replace(/`[^`]*`/g, "")
  const lines = withoutInlineCode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!
    if (!line.includes("?")) continue
    const cleaned = line
      .replace(/^[-*>\s]+/, "")
      .replace(/^\*{1,2}(?:quick\s+check|check(?:\s+question)?|understanding\s+check)\s*:?\*{1,2}\s*/i, "")
      .replace(/^(?:quick\s+check|check(?:\s+question)?|understanding\s+check)\s*:\s*/i, "")
      .trim()

    const match = /([^.!?\n]*\?)\s*$/.exec(cleaned)
    const question = (match?.[1] ?? cleaned).trim()
    if (question.length >= 8 && question.endsWith("?")) {
      return question
    }
  }
  return undefined
}

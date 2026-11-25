import path from "node:path"
import type { FileChangeSummary } from "./types.js"

const REPLY_PREVIEW_MAX_CHARS = 500

const WRAPPER_COMMANDS = new Set(["env", "sudo", "nohup", "time", "command", "exec"])
const SUDO_VALUE_FLAGS = new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U"])

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bFLW(?:SECK|PUBK)(?:_TEST)?-[A-Za-z0-9-]{8,}\b/g,
  /\bre_[A-Za-z0-9_]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
]

export function sanitizeSessionId(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_")
  return safe || "session"
}

export function projectFolderName(directory: string | undefined): string {
  if (!directory) return ""
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  return path.posix.basename(normalized)
}

export function toRelativePath(filePath: string, projectRoot?: string): string {
  const cleanFile = filePath.replaceAll("\\", "/")
  if (projectRoot) {
    const cleanRoot = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "")
    if (cleanRoot && cleanFile.startsWith(`${cleanRoot}/`)) {
      return cleanFile.slice(cleanRoot.length + 1).replace(/^\.\//, "")
    }
  }
  const stripped = cleanFile.replace(/^\.\//, "")
  if (stripped.startsWith("/") || /^[A-Za-z]:\//.test(stripped)) {
    return path.posix.basename(stripped)
  }
  return stripped
}

export function countLines(content: string): number {
  if (content.length === 0) return 0
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content
  if (trimmed.length === 0) return 0
  let count = 1
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) === 10) count += 1
  }
  return count
}

export function estimateEditLineCounts(oldString: string, newString: string): {
  readonly lines_added: number
  readonly lines_removed: number
} {
  return {
    lines_added: countLines(newString),
    lines_removed: countLines(oldString),
  }
}

export function parsePatchFileChanges(patchText: string, projectRoot?: string): FileChangeSummary[] {
  const results: FileChangeSummary[] = []
  let current: { path: string; added: number; removed: number } | undefined

  const pushCurrent = () => {
    if (!current) return
    results.push({
      path: current.path,
      lines_added: current.added,
      lines_removed: current.removed,
    })
    current = undefined
  }

  for (const line of patchText.split(/\r?\n/)) {
    const header = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/.exec(line)
    if (header?.[1]) {
      pushCurrent()
      current = { path: toRelativePath(header[1].trim(), projectRoot), added: 0, removed: 0 }
      continue
    }
    if (!current) continue
    if (line.startsWith("*** ")) continue
    if (line.startsWith("+")) current.added += 1
    else if (line.startsWith("-")) current.removed += 1
  }
  pushCurrent()
  return results
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaped = false

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true
      current += ch
      continue
    }
    if (quote) {
      if (ch === quote) quote = undefined
      current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === ";" || ch === "\n") {
      if (current.trim()) segments.push(current.trim())
      current = ""
      continue
    }
    const next = command[i + 1]
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      if (current.trim()) segments.push(current.trim())
      current = ""
      i += 1
      continue
    }
    if (ch === "|") {
      if (current.trim()) segments.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }

  if (current.trim()) segments.push(current.trim())
  return segments
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaped = false

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = undefined
      else current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function commandNameFromSegment(segment: string): string | undefined {
  const tokens = tokenizeSegment(segment)
  let index = 0

  while (index < tokens.length) {
    const token = tokens[index]
    if (!token) break
    if (isEnvAssignment(token)) {
      index += 1
      continue
    }
    const base = path.posix.basename(token.replaceAll("\\", "/"))
    if (WRAPPER_COMMANDS.has(base)) {
      index += 1
      if (base === "sudo") {
        while (index < tokens.length && tokens[index]?.startsWith("-")) {
          const flag = tokens[index]
          index += 1
          if (flag && SUDO_VALUE_FLAGS.has(flag)) index += 1
        }
      } else if (base === "env") {
        while (index < tokens.length && (tokens[index]?.startsWith("-") || isEnvAssignment(tokens[index] ?? ""))) {
          index += 1
        }
      }
      continue
    }
    if (token.startsWith("-") || token === "(" || token === ")" || token === "{" || token === "}") {
      index += 1
      continue
    }
    return base
  }
  return undefined
}

export function extractCommandNames(command: string): string[] {
  const names: string[] = []
  for (const segment of splitShellSegments(command)) {
    const name = commandNameFromSegment(segment)
    if (name) names.push(name)
  }
  return names
}

export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]")
  }
  return result
}

export function truncateReply(text: string): string {
  return redactSecrets(text).slice(0, REPLY_PREVIEW_MAX_CHARS)
}

export function extractPromptFiles(
  text: string,
  attachedFiles: readonly Readonly<Record<string, unknown>>[] | undefined,
  projectRoot?: string,
): string[] {
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const trimmed = value.trim().replace(/^@/, "")
    if (!trimmed) return
    const normalized = toRelativePath(trimmed, projectRoot)
    if (normalized) seen.add(normalized)
  }

  if (attachedFiles) {
    for (const file of attachedFiles) {
      if (typeof file.name === "string" && file.name.trim()) {
        add(file.name)
        continue
      }
      const mention = file.mention
      if (typeof mention === "object" && mention !== null && "text" in mention && typeof mention.text === "string") {
        add(mention.text)
        continue
      }
      const source = file.source
      if (typeof source === "object" && source !== null && "uri" in source && typeof source.uri === "string") {
        add(source.uri)
      }
    }
  }

  for (const match of text.matchAll(/(?:^|\s)@([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)/g)) {
    add(match[1])
  }

  return [...seen]
}

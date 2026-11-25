import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { RecorderRecord } from "./types.js"

export type RedactionKind =
  | "env_value"
  | "private_key"
  | "connection_password"
  | "anthropic_key"
  | "paystack_key"
  | "stripe_key"
  | "flutterwave_key"
  | "deepseek_key"
  | "openai_key"
  | "google_key"
  | "github_token"
  | "aws_key"
  | "slack_token"
  | "jwt"
  | "bearer_token"
  | "email"
  | "phone"
  | "high_entropy"

export type RedactionCounts = Partial<Record<RedactionKind, number>>

export interface RedactOptions {
  readonly envValues?: readonly string[]
}

export interface RedactTextOptions extends RedactOptions {
  readonly includePii?: boolean
}

export interface RedactTextResult {
  readonly text: string
  readonly counts: RedactionCounts
}

export interface RedactRecordResult<T extends RecorderRecord = RecorderRecord> {
  readonly record: T
  readonly counts: RedactionCounts
}

export interface RedactSessionResult {
  readonly records: readonly RecorderRecord[]
  readonly counts: RedactionCounts
}

const MIN_ENV_VALUE_LENGTH = 7 // strictly longer than 6 characters
const IGNORED_ENV_FILES = new Set([".env.example", ".env.sample", ".env.template"])

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IPV4_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const PLACEHOLDER_REGEX = /\[REDACTED:[a-z_]+\]/g

interface PatternRule {
  readonly kind: RedactionKind
  readonly pattern: RegExp
  readonly piiOnly?: boolean
  readonly replace?: (match: string, ...groups: string[]) => string
}

const PATTERN_RULES: readonly PatternRule[] = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    kind: "connection_password",
    pattern:
      /((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|sqlserver|ftp|sftp|http|https):\/\/[^:\s/@"']+:)(?!\[REDACTED:)([^\s"'/]+)@(?=[A-Za-z0-9._-]+(?::\d+)?(?:[/?#\s"']|$))/gi,
    replace: (_match, prefix) => `${prefix}[REDACTED:connection_password]@`,
  },
  {
    kind: "anthropic_key",
    pattern: /\bsk-ant-(?:api\d{2}-|admin\d{2}-|oat\d{2}-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    kind: "paystack_key",
    pattern: /\b(?:sk|pk)_(?:live|test)_[0-9a-f]{32,}\b/g,
  },
  {
    kind: "stripe_key",
    pattern: /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,})\b/g,
  },
  {
    kind: "flutterwave_key",
    pattern: /\bFLW(?:SECK|PUBK)(?:_TEST)?-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    kind: "deepseek_key",
    pattern: /\bsk-[0-9a-f]{32}\b/g,
  },
  {
    kind: "openai_key",
    pattern: /\bsk-(?:proj-|svcacct-|admin-|none-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    kind: "google_key",
    pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  },
  {
    kind: "github_token",
    pattern: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    kind: "aws_key",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: "slack_token",
    pattern:
      /(?:\bxox[baprs]-[0-9A-Za-z-]{10,}\b|https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+)/g,
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    kind: "bearer_token",
    pattern: /\bBearer\s+(?!\[REDACTED:)[A-Za-z0-9._~+/=-]{12,}\b/gi,
  },
  {
    kind: "email",
    piiOnly: true,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: "phone",
    piiOnly: true,
    pattern:
      /(?<!\w)(?:\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?(?:\d[\s.-]?){7,14}\d|\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|0\d{3}[-.\s]\d{3}[-.\s]\d{4})(?!\w)/g,
  },
]

function incrementCount(counts: RedactionCounts, kind: RedactionKind, amount = 1): void {
  counts[kind] = (counts[kind] ?? 0) + amount
}

function mergeCounts(target: RedactionCounts, source: RedactionCounts): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && value > 0) {
      const kind = key as RedactionKind
      target[kind] = (target[kind] ?? 0) + value
    }
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>()
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (!ch) continue
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function isLikelyHighEntropySecret(token: string): boolean {
  if (token.length < 32) return false
  if (UUID_REGEX.test(token)) return false

  // Pure alphabetic or snake/kebab code identifiers without digits are not treated as secrets.
  const hasDigit = /\d/.test(token)
  const hasLower = /[a-z]/.test(token)
  const hasUpper = /[A-Z]/.test(token)
  if (!hasDigit || (!hasLower && !hasUpper)) return false

  // Avoid flagging file paths or URLs containing slashes unless they look like base64 with padding.
  if (token.includes("/") && !token.endsWith("=")) return false

  const isHex = /^[0-9a-fA-F]{32,}$/.test(token)
  const entropy = shannonEntropy(token)
  if (isHex) return entropy >= 3.2

  const charClasses = Number(hasDigit) + Number(hasLower) + Number(hasUpper) + Number(/[+/=_-]/.test(token))
  if (charClasses >= 3) return entropy >= 3.4
  return entropy >= 3.7
}

function splitPreservingPlaceholders(input: string): Array<{ readonly text: string; readonly protected: boolean }> {
  const segments: Array<{ readonly text: string; readonly protected: boolean }> = []
  let lastIndex = 0
  PLACEHOLDER_REGEX.lastIndex = 0
  for (const match of input.matchAll(PLACEHOLDER_REGEX)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, index), protected: false })
    }
    segments.push({ text: match[0], protected: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), protected: false })
  }
  return segments
}

function applyUnprotected(
  input: string,
  transform: (segment: string) => string,
): string {
  const segments = splitPreservingPlaceholders(input)
  return segments.map((seg) => (seg.protected ? seg.text : transform(seg.text))).join("")
}

export function parseEnvValues(content: string): string[] {
  const values = new Set<string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line
    const eqIndex = normalized.indexOf("=")
    if (eqIndex <= 0) continue
    let value = normalized.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    } else {
      const commentIdx = value.indexOf(" #")
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim()
    }
    if (value.length >= MIN_ENV_VALUE_LENGTH) {
      values.add(value)
    }
  }
  return [...values].sort((a, b) => b.length - a.length)
}

export async function loadProjectEnvValues(projectDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return []
  }

  const envFiles = entries.filter(
    (name) => (name === ".env" || name.startsWith(".env.")) && !IGNORED_ENV_FILES.has(name),
  )

  const combined = new Set<string>()
  for (const name of envFiles) {
    try {
      const content = await readFile(path.join(projectDir, name), "utf8")
      for (const value of parseEnvValues(content)) {
        combined.add(value)
      }
    } catch {
      // Unreadable env files are skipped safely.
    }
  }
  return [...combined].sort((a, b) => b.length - a.length)
}

export function redactText(text: string, options: RedactTextOptions = {}): RedactTextResult {
  const counts: RedactionCounts = {}
  let current = text

  // 1. Project .env values (> 6 chars), longest first.
  const envValues = (options.envValues ?? [])
    .filter((value) => value.length >= MIN_ENV_VALUE_LENGTH)
    .toSorted((a, b) => b.length - a.length)

  if (envValues.length > 0) {
    const envPattern = new RegExp(envValues.map(escapeRegExp).join("|"), "g")
    current = applyUnprotected(current, (segment) =>
      segment.replace(envPattern, () => {
        incrementCount(counts, "env_value")
        return "[REDACTED:env_value]"
      }),
    )
  }

  // 2. Named secret, connection string, and PII patterns.
  const includePii = options.includePii ?? false
  for (const rule of PATTERN_RULES) {
    if (rule.piiOnly && !includePii) continue
    current = applyUnprotected(current, (segment) =>
      segment.replace(rule.pattern, (match, ...args) => {
        if (rule.kind === "phone" && IPV4_REGEX.test(match.trim())) {
          return match
        }
        incrementCount(counts, rule.kind)
        if (rule.replace) {
          const groups = args.filter((arg): arg is string => typeof arg === "string")
          return rule.replace(match, ...groups)
        }
        return `[REDACTED:${rule.kind}]`
      }),
    )
  }

  // 3. High-entropy 32+ character secrets.
  const highEntropyPattern = /(?<![A-Za-z0-9+/=_-])([A-Za-z0-9+/=_-]{32,})(?![A-Za-z0-9+/=_-])/g
  current = applyUnprotected(current, (segment) =>
    segment.replace(highEntropyPattern, (match) => {
      if (!isLikelyHighEntropySecret(match)) return match
      incrementCount(counts, "high_entropy")
      return "[REDACTED:high_entropy]"
    }),
  )

  return { text: current, counts }
}

export function redactRecord<T extends RecorderRecord>(
  record: T,
  options: RedactOptions = {},
): RedactRecordResult<T> {
  const counts: RedactionCounts = {}

  const clean = (value: string, includePii: boolean) => {
    const result = redactText(value, { ...options, includePii })
    mergeCounts(counts, result.counts)
    return result.text
  }

  switch (record.type) {
    case "start": {
      const next = {
        ...record,
        project_name: clean(record.project_name, false),
      }
      return { record: next as T, counts }
    }

    case "prompt": {
      const next = {
        ...record,
        text: clean(record.text, true),
        files: record.files.map((file) => clean(file, false)),
      }
      return { record: next as T, counts }
    }

    case "turn": {
      const next = {
        ...record,
        files_changed: record.files_changed.map((item) => ({
          ...item,
          path: clean(item.path, false),
        })),
        commands: record.commands.map((cmd) => clean(cmd, false)),
        reply_preview: clean(record.reply_preview, false),
      }
      return { record: next as T, counts }
    }

    case "teach_qa": {
      const next = {
        ...record,
        question: clean(record.question, true),
        answer: clean(record.answer, true),
      }
      return { record: next as T, counts }
    }

    case "end": {
      return { record: { ...record } as T, counts }
    }
  }
}

export function redactSession(
  records: readonly RecorderRecord[],
  options: RedactOptions = {},
): RedactSessionResult {
  const counts: RedactionCounts = {}
  const cleaned = records.map((record) => {
    const result = redactRecord(record, options)
    mergeCounts(counts, result.counts)
    return result.record
  })
  return { records: cleaned, counts }
}

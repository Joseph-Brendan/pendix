import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const NOTICES_FILE = "graded-notices.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function formatGradedStatus(score: number, reportEmailed: boolean): string {
  const scoreLabel = `${score.toFixed(1)}/10`
  return reportEmailed ? `Graded: ${scoreLabel} · report emailed` : `Graded: ${scoreLabel}`
}

function readSeenIds(configDir: string): Set<string> {
  const filePath = path.join(configDir, NOTICES_FILE)
  if (!existsSync(filePath)) return new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    if (isRecord(parsed) && Array.isArray(parsed.seen_ids)) {
      return new Set(parsed.seen_ids.filter((id): id is string => typeof id === "string"))
    }
  } catch {
    return new Set()
  }
  return new Set()
}

function writeSeenIds(configDir: string, ids: ReadonlySet<string>): void {
  try {
    mkdirSync(configDir, { recursive: true })
    const list = [...ids].slice(-100)
    writeFileSync(path.join(configDir, NOTICES_FILE), `${JSON.stringify({ seen_ids: list }, null, 2)}\n`, "utf8")
  } catch {
    // Non-critical startup notice state.
  }
}

export async function checkNewGradedNotice(options: {
  readonly apiUrl: string
  readonly authToken: string
  readonly configDir: string
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}): Promise<string | undefined> {
  const fetchFn = options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init))
  try {
    const response = await fetchFn(`${options.apiUrl.replace(/\/$/, "")}/sessions`, {
      method: "GET",
      headers: { authorization: `Bearer ${options.authToken}` },
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.sessions)) return undefined

    const seen = readSeenIds(options.configDir)
    for (const item of body.sessions) {
      if (!isRecord(item)) continue
      if (typeof item.id !== "string" || item.status !== "graded") continue
      if (typeof item.score !== "number") continue
      if (seen.has(item.id)) continue

      seen.add(item.id)
      writeSeenIds(options.configDir, seen)
      return formatGradedStatus(item.score, item.report_emailed === true)
    }
    return undefined
  } catch {
    return undefined
  }
}

import { createRecorderStateStore, listLocalSessions } from "@pendix/recorder"
import { resolvePendixApiUrl } from "@pendix/shared/urls"
import { Global } from "@pendix/util/global"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { createAuthStorage } from "../../pendix-auth/storage"

interface SessionRow {
  readonly id: string
  readonly project: string
  readonly status: "local" | "uploaded" | "graded"
  readonly score: number | null
  readonly time: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeRemoteStatus(status: unknown): "uploaded" | "graded" {
  return status === "graded" ? "graded" : "uploaded"
}

async function fetchRemoteSessions(apiUrl: string, token: string): Promise<SessionRow[]> {
  try {
    const response = await fetch(`${apiUrl}/sessions`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return []
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.sessions)) return []
    const rows: SessionRow[] = []
    for (const item of body.sessions) {
      if (!isRecord(item) || typeof item.id !== "string") continue
      rows.push({
        id: item.id,
        project: typeof item.project_title === "string" && item.project_title ? item.project_title : "-",
        status: normalizeRemoteStatus(item.status),
        score: typeof item.score === "number" ? item.score : null,
        time: typeof item.created_at === "string" ? item.created_at : "",
      })
    }
    return rows
  } catch {
    return []
  }
}

export default Runtime.handler(Commands.commands.sessions, (input) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const stateStore = createRecorderStateStore(global.data)
    const authStorage = createAuthStorage({ configDir: global.config })
    const token = authStorage.loadToken()

    const local = yield* Effect.promise(() => listLocalSessions(global.data, stateStore))
    const remote = token
      ? yield* Effect.promise(() => fetchRemoteSessions(resolvePendixApiUrl(), token.device_token))
      : []

    const remoteIds = new Set(remote.map((item) => item.id))
    const combined: SessionRow[] = [
      ...remote,
      ...local
        .filter((item) => !item.remoteId || !remoteIds.has(item.remoteId))
        .map((item) => ({
          id: item.sessionId,
          project: item.projectName || "-",
          status: item.status,
          score: item.score ?? null,
          time: item.time,
        })),
    ].sort((a, b) => b.time.localeCompare(a.time))

    if (input.json) {
      process.stdout.write(`${JSON.stringify({ sessions: combined })}\n`)
      return
    }

    if (combined.length === 0) {
      process.stdout.write("No sessions recorded yet.\n")
      return
    }

    for (const row of combined) {
      const scoreText = row.score !== null ? `${row.score}/10` : "-"
      process.stdout.write(`${row.project.padEnd(20)} ${row.status.padEnd(10)} ${scoreText.padEnd(8)} ${row.id}\n`)
    }
  }),
)

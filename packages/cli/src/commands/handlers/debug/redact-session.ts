import { readFile } from "node:fs/promises"
import path from "node:path"
import { loadProjectEnvValues, redactSession, sanitizeSessionId, type RecorderRecord } from "@pendix/recorder"
import { Global } from "@pendix/util/global"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

function parseJsonlRecords(raw: string): RecorderRecord[] {
  const records: RecorderRecord[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      // SAFETY: Local session JSONL files are written exclusively by @pendix/recorder in RecorderRecord format.
      records.push(parsed as RecorderRecord)
    }
  }
  return records
}

export default Runtime.handler(
  Commands.commands.debug.commands.redact,
  Effect.fn("cli.debug.redact")(function* (input) {
    const global = yield* Global.Service
    const filePath = path.join(global.data, "sessions", `${sanitizeSessionId(input.sessionID)}.jsonl`)
    const raw = yield* Effect.promise(() =>
      readFile(filePath, "utf8").catch(() => undefined),
    )

    if (raw === undefined) {
      process.stderr.write(`No recorded session found for "${input.sessionID}" at ${filePath}\n`)
      process.exitCode = 1
      return
    }

    const projectDir = Option.getOrUndefined(input.project) ?? process.cwd()
    const envValues = yield* Effect.promise(() => loadProjectEnvValues(projectDir))
    const records = parseJsonlRecords(raw)
    const { records: cleaned, counts } = redactSession(records, { envValues })

    for (const record of cleaned) {
      process.stdout.write(`${JSON.stringify(record)}\n`)
    }

    const summary = Object.entries(counts)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(", ")

    process.stdout.write(`Redactions: ${summary || "none"}\n`)
  }),
)

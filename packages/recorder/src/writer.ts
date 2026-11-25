import { appendFile as fsAppendFile, mkdir as fsMkdir } from "node:fs/promises"
import path from "node:path"
import type { RecorderRecord } from "./types.js"

export type AppendFileFn = (filePath: string, data: string) => Promise<void>
export type ErrorHandler = (error: unknown, context: { readonly filePath: string }) => void

export interface AsyncJsonlWriterOptions {
  readonly appendFile?: AppendFileFn
  readonly onError?: ErrorHandler
}

export interface AsyncJsonlWriter {
  enqueue(filePath: string, record: RecorderRecord): void
  flush(): Promise<void>
}

export function createAsyncJsonlWriter(options: AsyncJsonlWriterOptions = {}): AsyncJsonlWriter {
  const ensuredDirs = new Set<string>()
  const pending = new Map<string, string[]>()
  let scheduled = false
  let chain: Promise<void> = Promise.resolve()

  const writeChunk: AppendFileFn =
    options.appendFile ??
    (async (filePath: string, data: string) => {
      const dir = path.dirname(filePath)
      if (!ensuredDirs.has(dir)) {
        await fsMkdir(dir, { recursive: true, mode: 0o700 })
        ensuredDirs.add(dir)
      }
      await fsAppendFile(filePath, data, { encoding: "utf8", mode: 0o600 })
    })

  const reportError = (error: unknown, filePath: string) => {
    try {
      options.onError?.(error, { filePath })
    } catch {
      // Never allow an error logger to crash the agent.
    }
  }

  const drain = async () => {
    while (pending.size > 0) {
      const entries = [...pending.entries()]
      pending.clear()
      for (const [filePath, lines] of entries) {
        if (lines.length === 0) continue
        const payload = lines.join("")
        try {
          await writeChunk(filePath, payload)
        } catch (error) {
          reportError(error, filePath)
        }
      }
    }
  }

  const scheduleDrain = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      chain = chain.then(drain, drain)
    })
  }

  return {
    enqueue(filePath, record) {
      let line: string
      try {
        line = `${JSON.stringify(record)}\n`
      } catch (error) {
        reportError(error, filePath)
        return
      }
      const queue = pending.get(filePath)
      if (queue) {
        queue.push(line)
      } else {
        pending.set(filePath, [line])
      }
      scheduleDrain()
    },

    async flush() {
      // Wait for any queued microtask to attach to the drain chain.
      await Promise.resolve()
      await chain
      if (pending.size > 0) {
        chain = chain.then(drain, drain)
        await chain
      }
    },
  }
}

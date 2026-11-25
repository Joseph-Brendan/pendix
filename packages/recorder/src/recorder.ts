import path from "node:path"
import {
  countLines,
  estimateEditLineCounts,
  extractCommandNames,
  extractPromptFiles,
  parsePatchFileChanges,
  projectFolderName,
  redactSecrets,
  sanitizeSessionId,
  toRelativePath,
  truncateReply,
} from "./sanitize.js"
import type {
  EndReason,
  EngineEventLike,
  FileChangeSummary,
  RecorderRecord,
} from "./types.js"
import { createAsyncJsonlWriter, type AppendFileFn, type ErrorHandler } from "./writer.js"

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000

export interface SessionRecorderOptions {
  readonly dataDir: string
  readonly idleTimeoutMs?: number
  readonly now?: () => number
  readonly appendFile?: AppendFileFn
  readonly onError?: ErrorHandler
}

interface PendingTurn {
  readonly tools: Record<string, number>
  readonly toolNamesById: Map<string, string>
  readonly filesByPath: Map<string, { added: number; removed: number }>
  readonly fileEstimatesByCallId: Map<string, FileChangeSummary[]>
  readonly commands: string[]
  errored: boolean
  latestReply: string
  hasActivity: boolean
}

interface ActiveSession {
  readonly sessionId: string
  readonly filePath: string
  readonly projectRoot?: string
  readonly isSubagent: boolean
  provider: string
  model: string
  teachMode: boolean
  ended: boolean
  turn?: PendingTurn
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface SessionRecorder {
  filePathFor(sessionId: string): string
  handleEngineEvent(event: EngineEventLike): void
  recordTeachQA(sessionId: string, input: { readonly question: string; readonly answer: string; readonly time?: number }): void
  endSession(sessionId: string, reason: EndReason, time?: number): void
  closeAll(reason?: EndReason): void
  flush(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createPendingTurn(): PendingTurn {
  return {
    tools: {},
    toolNamesById: new Map(),
    filesByPath: new Map(),
    fileEstimatesByCallId: new Map(),
    commands: [],
    errored: false,
    latestReply: "",
    hasActivity: false,
  }
}

export function createSessionRecorder(options: SessionRecorderOptions): SessionRecorder {
  const sessionsDir = path.join(options.dataDir, "sessions")
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())
  const writer = createAsyncJsonlWriter({
    appendFile: options.appendFile,
    onError: options.onError,
  })

  const sessions = new Map<string, ActiveSession>()
  let activePrimarySessionId: string | undefined

  const filePathFor = (sessionId: string) => path.join(sessionsDir, `${sanitizeSessionId(sessionId)}.jsonl`)

  const isoTime = (timestamp?: number) => new Date(timestamp ?? now()).toISOString()

  const emit = (session: ActiveSession, record: RecorderRecord) => {
    writer.enqueue(session.filePath, record)
  }

  const clearIdleTimer = (session: ActiveSession) => {
    if (!session.idleTimer) return
    clearTimeout(session.idleTimer)
    session.idleTimer = undefined
  }

  const touchIdleTimer = (session: ActiveSession) => {
    clearIdleTimer(session)
    if (session.ended || idleTimeoutMs <= 0) return
    const timer = setTimeout(() => {
      endSession(session.sessionId, "idle_30m")
    }, idleTimeoutMs)
    timer.unref?.()
    session.idleTimer = timer
  }

  const mergeFileChanges = (turn: PendingTurn, changes: readonly FileChangeSummary[]) => {
    for (const change of changes) {
      if (!change.path) continue
      const existing = turn.filesByPath.get(change.path)
      if (existing) {
        existing.added += change.lines_added
        existing.removed += change.lines_removed
      } else {
        turn.filesByPath.set(change.path, {
          added: change.lines_added,
          removed: change.lines_removed,
        })
      }
    }
  }

  const flushTurn = (session: ActiveSession, timestamp?: number) => {
    const turn = session.turn
    if (!turn) return
    session.turn = undefined
    if (!turn.hasActivity) return

    // Any file-modifying tool calls without diff metadata fall back to their line-count estimates.
    for (const estimated of turn.fileEstimatesByCallId.values()) {
      mergeFileChanges(turn, estimated)
    }
    turn.fileEstimatesByCallId.clear()

    const filesChanged: FileChangeSummary[] = [...turn.filesByPath.entries()].map(([filePath, counts]) => ({
      path: filePath,
      lines_added: counts.added,
      lines_removed: counts.removed,
    }))

    emit(session, {
      type: "turn",
      session_id: session.sessionId,
      time: isoTime(timestamp),
      tools: { ...turn.tools },
      files_changed: filesChanged,
      commands: [...turn.commands],
      errored: turn.errored,
      reply_preview: truncateReply(turn.latestReply),
    })
  }

  const ensureTurn = (session: ActiveSession): PendingTurn => {
    if (!session.turn) {
      session.turn = createPendingTurn()
    }
    return session.turn
  }

  const endSession = (sessionId: string, reason: EndReason, time?: number) => {
    const session = sessions.get(sessionId)
    if (!session || session.ended) return
    clearIdleTimer(session)
    flushTurn(session, time)
    session.ended = true
    emit(session, {
      type: "end",
      session_id: session.sessionId,
      time: isoTime(time),
      reason,
    })
    if (activePrimarySessionId === sessionId) {
      activePrimarySessionId = undefined
    }
    sessions.delete(sessionId)
  }

  const closeAll = (reason: EndReason = "quit") => {
    for (const sessionId of [...sessions.keys()]) {
      endSession(sessionId, reason)
    }
  }

  const recordTeachQA = (
    sessionId: string,
    input: { readonly question: string; readonly answer: string; readonly time?: number },
  ) => {
    const session = sessions.get(sessionId)
    if (!session || session.ended) return
    touchIdleTimer(session)
    emit(session, {
      type: "teach_qa",
      session_id: sessionId,
      time: isoTime(input.time),
      question: redactSecrets(input.question),
      answer: redactSecrets(input.answer),
    })
  }

  const handleSessionCreated = (event: EngineEventLike) => {
    const sessionId = typeof event.data.sessionID === "string" ? event.data.sessionID : undefined
    if (!sessionId) return

    const isSubagent = typeof event.data.parentID === "string" && event.data.parentID.length > 0
    if (!isSubagent && activePrimarySessionId && activePrimarySessionId !== sessionId) {
      endSession(activePrimarySessionId, "new_session", event.created)
    }

    const location = isRecord(event.data.location) ? event.data.location : undefined
    const directory = typeof location?.directory === "string" ? location.directory : undefined
    const modelRef = isRecord(event.data.model) ? event.data.model : undefined
    const provider = typeof modelRef?.providerID === "string" ? modelRef.providerID : ""
    const model = typeof modelRef?.id === "string" ? modelRef.id : ""
    const metadata = isRecord(event.data.metadata) ? event.data.metadata : undefined
    const teachMode = metadata?.teach_mode === true

    const session: ActiveSession = {
      sessionId,
      filePath: filePathFor(sessionId),
      projectRoot: directory,
      isSubagent,
      provider,
      model,
      teachMode,
      ended: false,
    }
    sessions.set(sessionId, session)
    if (!isSubagent) activePrimarySessionId = sessionId
    touchIdleTimer(session)

    emit(session, {
      type: "start",
      session_id: sessionId,
      time: isoTime(event.created),
      project_name: projectFolderName(directory),
      provider,
      model,
      teach_mode: teachMode,
    })
  }

  const handleEngineEvent = (event: EngineEventLike) => {
    try {
      if (event.type === "session.created") {
        handleSessionCreated(event)
        return
      }

      const sessionId = typeof event.data.sessionID === "string" ? event.data.sessionID : undefined
      if (!sessionId) return

      const session = sessions.get(sessionId)
      if (!session || session.ended) return
      touchIdleTimer(session)

      switch (event.type) {
        case "session.model.selected":
        case "session.step.started": {
          const modelRef = isRecord(event.data.model) ? event.data.model : undefined
          if (typeof modelRef?.providerID === "string") session.provider = modelRef.providerID
          if (typeof modelRef?.id === "string") session.model = modelRef.id
          return
        }

        case "session.inbox.enqueued": {
          const item = isRecord(event.data.item) ? event.data.item : undefined
          if (!item || item.type !== "user") return
          const payload = isRecord(item.payload) ? item.payload : undefined
          if (!payload || typeof payload.text !== "string") return
          const rawFiles = Array.isArray(payload.files)
            ? payload.files.filter((entry): entry is Record<string, unknown> => isRecord(entry))
            : undefined
          const files = extractPromptFiles(payload.text, rawFiles, session.projectRoot)
          emit(session, {
            type: "prompt",
            session_id: sessionId,
            time: isoTime(event.created),
            text: redactSecrets(payload.text),
            files,
          })
          return
        }

        case "session.execution.started": {
          const turn = ensureTurn(session)
          turn.hasActivity = true
          return
        }

        case "session.tool.input.started": {
          const id = typeof event.data.id === "string" ? event.data.id : undefined
          const name = typeof event.data.name === "string" ? event.data.name : undefined
          if (!id || !name) return
          const turn = ensureTurn(session)
          turn.hasActivity = true
          turn.toolNamesById.set(id, name)
          return
        }

        case "session.tool.called": {
          const id = typeof event.data.id === "string" ? event.data.id : undefined
          if (!id) return
          const turn = ensureTurn(session)
          turn.hasActivity = true
          const toolName = turn.toolNamesById.get(id) ?? "unknown"
          turn.tools[toolName] = (turn.tools[toolName] ?? 0) + 1

          const input = isRecord(event.data.input) ? event.data.input : undefined
          if (!input) return

          if ((toolName === "shell" || toolName === "bash" || toolName === "terminal") && typeof input.command === "string") {
            for (const cmd of extractCommandNames(input.command)) {
              turn.commands.push(cmd)
            }
            return
          }

          if (toolName === "write" && typeof input.path === "string") {
            const added = typeof input.content === "string" ? countLines(input.content) : 0
            turn.fileEstimatesByCallId.set(id, [
              { path: toRelativePath(input.path, session.projectRoot), lines_added: added, lines_removed: 0 },
            ])
            return
          }

          if (toolName === "edit" && typeof input.path === "string") {
            const oldStr = typeof input.oldString === "string" ? input.oldString : ""
            const newStr = typeof input.newString === "string" ? input.newString : ""
            const counts = estimateEditLineCounts(oldStr, newStr)
            turn.fileEstimatesByCallId.set(id, [
              {
                path: toRelativePath(input.path, session.projectRoot),
                lines_added: counts.lines_added,
                lines_removed: counts.lines_removed,
              },
            ])
            return
          }

          if (toolName === "patch" && typeof input.patchText === "string") {
            const parsed = parsePatchFileChanges(input.patchText, session.projectRoot)
            if (parsed.length > 0) {
              turn.fileEstimatesByCallId.set(id, parsed)
            }
          }
          return
        }

        case "session.tool.success":
        case "session.tool.failed": {
          const id = typeof event.data.id === "string" ? event.data.id : undefined
          const turn = ensureTurn(session)
          turn.hasActivity = true
          if (event.type === "session.tool.failed") {
            turn.errored = true
          }

          const metadata = isRecord(event.data.metadata) ? event.data.metadata : undefined
          const metaFiles = Array.isArray(metadata?.files) ? metadata.files : undefined
          if (metaFiles && metaFiles.length > 0) {
            const diffs: FileChangeSummary[] = []
            for (const entry of metaFiles) {
              if (!isRecord(entry) || typeof entry.file !== "string") continue
              diffs.push({
                path: toRelativePath(entry.file, session.projectRoot),
                lines_added: typeof entry.additions === "number" ? entry.additions : 0,
                lines_removed: typeof entry.deletions === "number" ? entry.deletions : 0,
              })
            }
            if (diffs.length > 0) {
              if (id) turn.fileEstimatesByCallId.delete(id)
              mergeFileChanges(turn, diffs)
              return
            }
          }
          if (id) {
            const estimated = turn.fileEstimatesByCallId.get(id)
            if (estimated) {
              turn.fileEstimatesByCallId.delete(id)
              if (event.type === "session.tool.success") {
                mergeFileChanges(turn, estimated)
              }
            }
          }
          return
        }

        case "session.text.ended": {
          if (typeof event.data.text !== "string") return
          const turn = ensureTurn(session)
          turn.hasActivity = true
          turn.latestReply = event.data.text
          return
        }

        case "session.step.failed": {
          const turn = ensureTurn(session)
          turn.hasActivity = true
          turn.errored = true
          return
        }

        case "session.execution.succeeded": {
          flushTurn(session, event.created)
          return
        }

        case "session.execution.failed": {
          const turn = ensureTurn(session)
          turn.hasActivity = true
          turn.errored = true
          flushTurn(session, event.created)
          return
        }

        case "session.execution.interrupted": {
          flushTurn(session, event.created)
          if (event.data.reason === "shutdown") {
            endSession(sessionId, "quit", event.created)
          }
          return
        }

        case "session.synthetic": {
          const metadata = isRecord(event.data.metadata) ? event.data.metadata : undefined
          if (
            metadata?.kind === "pendix.teach_qa" &&
            typeof metadata.question === "string" &&
            typeof metadata.answer === "string"
          ) {
            recordTeachQA(sessionId, {
              question: metadata.question,
              answer: metadata.answer,
              time: event.created,
            })
          }
          return
        }

        case "session.archived":
        case "session.deleted": {
          endSession(sessionId, "quit", event.created)
          return
        }

        default:
          return
      }
    } catch (error) {
      try {
        options.onError?.(error, { filePath: sessionsDir })
      } catch {
        // Never allow recorder errors to interfere with the agent.
      }
    }
  }

  return {
    filePathFor,
    handleEngineEvent,
    recordTeachQA,
    endSession,
    closeAll,
    flush: () => writer.flush(),
  }
}

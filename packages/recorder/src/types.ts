export type EndReason = "quit" | "idle_30m" | "new_session"

export interface FileChangeSummary {
  readonly path: string
  readonly lines_added: number
  readonly lines_removed: number
}

export interface StartRecord {
  readonly type: "start"
  readonly session_id: string
  readonly time: string
  readonly project_name: string
  readonly provider: string
  readonly model: string
  readonly teach_mode: boolean
}

export interface PromptRecord {
  readonly type: "prompt"
  readonly session_id: string
  readonly time: string
  readonly text: string
  readonly files: readonly string[]
}

export interface TurnRecord {
  readonly type: "turn"
  readonly session_id: string
  readonly time: string
  readonly tools: Readonly<Record<string, number>>
  readonly files_changed: readonly FileChangeSummary[]
  readonly commands: readonly string[]
  readonly errored: boolean
  readonly reply_preview: string
}

export interface TeachQARecord {
  readonly type: "teach_qa"
  readonly session_id: string
  readonly time: string
  readonly question: string
  readonly answer: string
}

export interface EndRecord {
  readonly type: "end"
  readonly session_id: string
  readonly time: string
  readonly reason: EndReason
}

export type RecorderRecord = StartRecord | PromptRecord | TurnRecord | TeachQARecord | EndRecord

export interface EngineEventLike {
  readonly type: string
  readonly created?: number
  readonly data: Readonly<Record<string, unknown>>
}

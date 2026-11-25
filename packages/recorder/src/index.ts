export {
  IDLE_TIMEOUT_MS,
  createSessionRecorder,
  type SessionRecorder,
  type SessionRecorderOptions,
} from "./recorder.js"

export {
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

export {
  loadProjectEnvValues,
  parseEnvValues,
  redactRecord,
  redactSession,
  redactText,
  type RedactOptions,
  type RedactRecordResult,
  type RedactSessionResult,
  type RedactTextOptions,
  type RedactTextResult,
  type RedactionCounts,
  type RedactionKind,
} from "./redact.js"

export {
  GRADING_CONSENT_COPY,
  GRADING_CONSENT_VERSION,
  LOCAL_RETENTION_AFTER_UPLOAD_MS,
  MAX_RECORD_BYTES,
  createRecorderStateStore,
  type GradingConsentState,
  type QueuedSessionUpload,
  type RecorderState,
  type RecorderStateStore,
  type UploadedSessionMeta,
} from "./preferences.js"

export {
  cleanupOldLocalRecords,
  drainUploadQueue,
  handleSessionEnd,
  listLocalSessions,
  readSessionRecords,
  sessionFilePath,
  type CreditPromptChoice,
  type CreditPromptInfo,
  type DrainQueueOptions,
  type DrainQueueResult,
  type FetchFn,
  type HandleSessionEndOptions,
  type HandleSessionEndResult,
  type LocalSessionSummary,
  type UploadAccountInfo,
} from "./uploader.js"

export {
  createAsyncJsonlWriter,
  type AppendFileFn,
  type AsyncJsonlWriter,
  type AsyncJsonlWriterOptions,
  type ErrorHandler,
} from "./writer.js"

export type {
  EndReason,
  EndRecord,
  EngineEventLike,
  FileChangeSummary,
  PromptRecord,
  RecorderRecord,
  StartRecord,
  TeachQARecord,
  TurnRecord,
} from "./types.js"

import pino, { type DestinationStream, type Logger } from "pino"

export interface CreateLoggerOptions {
  readonly level?: string
  readonly destination?: DestinationStream
}

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "authorization",
  "cookie",
  "*.secret",
  "*.token",
  "*.password",
  "*.dob",
]

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config = {
    level: options.level ?? "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    base: {
      service: "pendix-cloud",
    },
  }
  if (options.destination) return pino(config, options.destination)
  return pino(config)
}

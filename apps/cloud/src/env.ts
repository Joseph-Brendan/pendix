import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const defaultEnvFile = path.resolve(currentDir, "../.env")

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://pendix:pendix@127.0.0.1:5433/pendix"),
  TEST_DATABASE_URL: z.string().min(1).default("postgres://pendix:pendix@127.0.0.1:5434/pendix_test"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  API_URL: z.string().default("http://127.0.0.1:3001"),
  WEB_URL: z.string().default("http://127.0.0.1:5173"),
  AUTH_SECRET: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("noreply@pendix.dev"),
  PAYOUT_ENCRYPTION_KEY: z.string().default(""),
  SENTRY_DSN_API: z.string().default(""),
  RATE_LIMIT_IP_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_IP_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_USER_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_USER_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
})

export type CloudEnv = z.infer<typeof EnvSchema>

export function readDotEnvFile(filePath = defaultEnvFile): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, "utf8")
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eqIndex = line.indexOf("=")
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    const value = line.slice(eqIndex + 1).trim()
    values[key] = value
  }
  return values
}

export function loadEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
  envFilePath = defaultEnvFile,
): CloudEnv {
  const fromFile = readDotEnvFile(envFilePath)
  const merged: Record<string, string | undefined> = { ...fromFile }
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") merged[key] = value
  }
  return EnvSchema.parse(merged)
}

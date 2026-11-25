import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  loadProjectEnvValues,
  parseEnvValues,
  redactRecord,
  redactSession,
  redactText,
  type PromptRecord,
  type RecorderRecord,
} from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-redact-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

// Build synthetic test tokens from pieces so static secret scanners do not flag test fixtures.
const join = (...parts: string[]) => parts.join("")

// 42 real-looking secret & PII samples covering every required pattern.
const SECRET_SAMPLES: ReadonlyArray<{ readonly label: string; readonly value: string; readonly expectedKind: string }> = [
  // OpenAI
  { label: "OpenAI standard sk- key", value: join("sk", "-proj-", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd"), expectedKind: "openai_key" },
  { label: "OpenAI legacy sk- key", value: join("sk", "-T3Blbk", "FJ9a8b7c6d5e4f3g2h1i0jKlMnOpQrStUvWx"), expectedKind: "openai_key" },
  { label: "OpenAI service account key", value: join("sk", "-svcacct-", "QwErTyUiOpAsDfGhJkLzXcVbNm12345678"), expectedKind: "openai_key" },
  // Anthropic
  { label: "Anthropic api03 key", value: join("sk", "-ant-api03-", "9xYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_AA"), expectedKind: "anthropic_key" },
  { label: "Anthropic admin key", value: join("sk", "-ant-admin01-", "AbCdEfGhIjKlMnOpQrStUvWxYz9876543210"), expectedKind: "anthropic_key" },
  // Google
  { label: "Google API key", value: join("AIza", "SyD4x9KpLmNoPqRsTuVwXyZ0123456789ab"), expectedKind: "google_key" },
  { label: "Google Gemini key", value: join("AIza", "SyB9mK2nP4qR6sT8uV0wX2yZ4aB6cD8eF0g"), expectedKind: "google_key" },
  // DeepSeek
  { label: "DeepSeek hex key", value: join("sk", "-4f8a9c2e1b7d6f0a3c5e8b2d4f6a9c1e"), expectedKind: "deepseek_key" },
  // GitHub
  { label: "GitHub personal access token (ghp_)", value: join("ghp", "_1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7q8R"), expectedKind: "github_token" },
  { label: "GitHub OAuth token (gho_)", value: join("gho", "_9z8Y7x6W5v4U3t2S1r0Q9p8O7n6M5l4K3j2I"), expectedKind: "github_token" },
  { label: "GitHub user-to-server token (ghu_)", value: join("ghu", "_AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp1234"), expectedKind: "github_token" },
  { label: "GitHub server token (ghs_)", value: join("ghs", "_ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKk5678"), expectedKind: "github_token" },
  { label: "GitHub fine-grained PAT", value: join("github", "_pat_11ABCDEFG0123456789_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"), expectedKind: "github_token" },
  // Flutterwave
  { label: "Flutterwave live secret", value: join("FLW", "SECK-8a9b7c6d5e4f3a2b1c0d9e8f7a6b5c4d-X"), expectedKind: "flutterwave_key" },
  { label: "Flutterwave test secret", value: join("FLW", "SECK_TEST-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d-X"), expectedKind: "flutterwave_key" },
  { label: "Flutterwave live public", value: join("FLW", "PUBK-2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e-X"), expectedKind: "flutterwave_key" },
  { label: "Flutterwave test public", value: join("FLW", "PUBK_TEST-3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f-X"), expectedKind: "flutterwave_key" },
  // Paystack
  { label: "Paystack live secret", value: join("sk", "_live_4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b"), expectedKind: "paystack_key" },
  { label: "Paystack test secret", value: join("sk", "_test_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e"), expectedKind: "paystack_key" },
  { label: "Paystack live public", value: join("pk", "_live_11223344556677889900aabbccddeeff11223344"), expectedKind: "paystack_key" },
  // Stripe
  { label: "Stripe live secret", value: join("sk", "_live_51NxYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789"), expectedKind: "stripe_key" },
  { label: "Stripe test secret", value: join("sk", "_test_51MqRsTuVwXyZaBcDeFgHiJkLmNoPqRsT9876543210"), expectedKind: "stripe_key" },
  { label: "Stripe restricted key", value: join("rk", "_live_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"), expectedKind: "stripe_key" },
  { label: "Stripe webhook secret", value: join("whsec", "_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"), expectedKind: "stripe_key" },
  // AWS
  { label: "AWS access key AKIA", value: join("AKIA", "IOSFODNN7EXAMPLE"), expectedKind: "aws_key" },
  { label: "AWS temporary key ASIA", value: join("ASIA", "Q3G4R5T6Y7U8I9O0"), expectedKind: "aws_key" },
  // Slack
  { label: "Slack bot token", value: join("xoxb", "-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"), expectedKind: "slack_token" },
  { label: "Slack user token", value: join("xoxp", "-987654321098-123456789012-123456789012-a1b2c3d4e5f6a7b8c9d0"), expectedKind: "slack_token" },
  { label: "Slack webhook URL", value: join("https://hooks.slack.com/services/", "T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"), expectedKind: "slack_token" },
  // JWT
  {
    label: "JWT token",
    value: join("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".eyJzdWIiOiJ1c2VyXzEyMyIsImV4cCI6MTc5OTk5OTk5OX0", ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"),
    expectedKind: "jwt",
  },
  // Bearer
  { label: "Bearer auth header", value: join("Bearer ", "pdx_dev_AbCdEfGhIjKlMnOpQrStUvWx123456"), expectedKind: "bearer_token" },
  { label: "Bearer lowercase token", value: join("bearer ", "tok_9x8y7z6w5v4u3t2s1r0q9p8o"), expectedKind: "bearer_token" },
  // Private key blocks
  {
    label: "RSA private key block",
    value: join("-----BEGIN ", "RSA PRIVATE KEY-----", "\nMIIEpAIBAAKCAQEAtestkeydata1234567890\n", "-----END ", "RSA PRIVATE KEY-----"),
    expectedKind: "private_key",
  },
  {
    label: "OpenSSH private key block",
    value: join("-----BEGIN ", "OPENSSH PRIVATE KEY-----", "\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n", "-----END ", "OPENSSH PRIVATE KEY-----"),
    expectedKind: "private_key",
  },
  // Connection strings
  { label: "Postgres connection password", value: join("postgres://pendix:", "SuperS3cretPass!@db.internal:5432/pendix"), expectedKind: "connection_password" },
  { label: "MongoDB SRV connection password", value: join("mongodb+srv://admin:", "MyMongoPass99@cluster0.example.net/app"), expectedKind: "connection_password" },
  { label: "Redis connection password", value: join("rediss://default:", "r3d1sP@ssw0rd@cache.internal:6379/0"), expectedKind: "connection_password" },
  // Emails (in prompt text)
  { label: "Standard email", value: "ada.lovelace@example.com", expectedKind: "email" },
  { label: "Plus-addressed email", value: "learner+billing@school.edu.ng", expectedKind: "email" },
  // Phone numbers (in prompt text)
  { label: "US phone with country code", value: "+1 (415) 555-2671", expectedKind: "phone" },
  { label: "Nigerian international phone", value: "+234 803 123 4567", expectedKind: "phone" },
  { label: "Dashed US phone", value: "415-555-0199", expectedKind: "phone" },
  // High-entropy 32+ char secrets
  { label: "High-entropy base64 secret", value: join("9kLmN2pQrStUvWxYz", "3aB4cD5eF6gH7iJ8kL9mN0pQ=="), expectedKind: "high_entropy" },
  { label: "High-entropy 40-char mixed secret", value: join("a9X3mP7qR2vT8wZ1bN6c", "K4jH5fD0gS2yL8uE3nM9"), expectedKind: "high_entropy" },
]

// 24 normal words, code identifiers, and non-secret literals that MUST NOT be redacted.
const SAFE_IDENTIFIERS: readonly string[] = [
  "useEffect",
  "useCallback",
  "useLayoutEffect",
  "createSessionRecorder",
  "AuthenticationProviderConfigurationManager",
  "MAX_RETRY_ATTEMPTS_BEFORE_FALLBACK_TIMEOUT",
  "packages/recorder/src/sanitize.ts",
  "https://docs.example.com/getting-started/installation",
  "550e8400-e29b-41d4-a716-446655440000",
  "2026-11-25T10:15:01.000Z",
  "127.0.0.1",
  "192.168.1.42",
  "v2.4.0",
  "my-very-long-kebab-case-feature-branch-name",
  "@src/components/DashboardHeader.tsx",
  "@pendix/shared/plans",
  "PostgreSQL",
  "TypeScript",
  "tailwindcss",
  "drizzle-orm",
  "handleSessionExecutionSucceededEvent",
  "getEntitlementsForSubscriptionPlan",
  "application/json",
  "2026-11-25",
]

describe("@pendix/recorder redaction", () => {
  it("redacts at least 40 real-looking secret and PII samples with [REDACTED:kind] and counts by kind", () => {
    expect(SECRET_SAMPLES.length).toBeGreaterThanOrEqual(40)

    for (const sample of SECRET_SAMPLES) {
      const input = `Please check ${sample.value} in the logs.`
      const result = redactText(input, { includePii: true })

      expect(result.text, `expected ${sample.label} to be redacted`).toContain(`[REDACTED:${sample.expectedKind}]`)
      if (sample.expectedKind === "connection_password") {
        // Password segment must be removed while keeping protocol/host readable.
        const passwordMatch = /:\/\/[^:]+:([^@]+)@/.exec(sample.value)
        expect(passwordMatch?.[1]).toBeTruthy()
        expect(result.text, `password from ${sample.label} leaked`).not.toContain(passwordMatch![1])
      } else {
        expect(result.text, `${sample.label} leaked into output`).not.toContain(sample.value)
      }
      expect(result.counts[sample.expectedKind as keyof typeof result.counts], `count missing for ${sample.label}`).toBeGreaterThanOrEqual(1)
    }
  })

  it("does not redact at least 20 normal words, code identifiers, UUIDs, paths, or dates", () => {
    expect(SAFE_IDENTIFIERS.length).toBeGreaterThanOrEqual(20)

    for (const safe of SAFE_IDENTIFIERS) {
      const input = `Refactor ${safe} so the test passes cleanly.`
      const result = redactText(input, { includePii: true })
      expect(result.text, `false positive on "${safe}"`).toBe(input)
      expect(result.counts, `unexpected redaction counts for "${safe}"`).toEqual({})
    }
  })

  it("redacts values from a project's .env files longer than 6 characters wherever they appear, while ignoring short values", async () => {
    const projectDir = await makeTempDir()
    await writeFile(
      path.join(projectDir, ".env"),
      [
        "# Local secrets",
        'CUSTOM_APP_TOKEN="my-custom-project-secret-phrase"',
        "SHORT_VAL=abc123",
        "DB_NAME=pendix",
        "WEBHOOK_SIGNING_WORD=purple-elephant-sunrise",
      ].join("\n"),
      "utf8",
    )
    await writeFile(
      path.join(projectDir, ".env.local"),
      "EXTRA_LOCAL_SECRET=banana-mango-tangerine\n",
      "utf8",
    )
    // .env.example placeholders must not be loaded as real secrets.
    await writeFile(
      path.join(projectDir, ".env.example"),
      "CUSTOM_APP_TOKEN=replace-me-example-placeholder\n",
      "utf8",
    )

    const envValues = await loadProjectEnvValues(projectDir)
    expect(envValues).toContain("my-custom-project-secret-phrase")
    expect(envValues).toContain("purple-elephant-sunrise")
    expect(envValues).toContain("banana-mango-tangerine")
    expect(envValues).not.toContain("abc123")
    expect(envValues).not.toContain("pendix")
    expect(envValues).not.toContain("replace-me-example-placeholder")

    const records: RecorderRecord[] = [
      {
        type: "prompt",
        session_id: "ses_env_1",
        time: "2026-11-25T10:00:00.000Z",
        text: "Why does my-custom-project-secret-phrase fail with abc123 and banana-mango-tangerine?",
        files: ["src/config.ts"],
      },
      {
        type: "turn",
        session_id: "ses_env_1",
        time: "2026-11-25T10:00:05.000Z",
        tools: { read: 1 },
        files_changed: [],
        commands: [],
        errored: false,
        reply_preview: "Found purple-elephant-sunrise in config.",
      },
    ]

    const cleaned = redactSession(records, { envValues })
    const serialized = JSON.stringify(cleaned.records)
    expect(serialized).not.toContain("my-custom-project-secret-phrase")
    expect(serialized).not.toContain("purple-elephant-sunrise")
    expect(serialized).not.toContain("banana-mango-tangerine")
    // Short <= 6 char values are not treated as env secrets.
    expect(serialized).toContain("abc123")
    expect(cleaned.counts.env_value).toBe(3)
  })

  it("is pure and idempotent: running redactRecord twice produces the exact same output and zero new redactions", () => {
    const envValues = parseEnvValues("MY_SECRET=correct-horse-battery-staple\n")
    const original: PromptRecord = {
      type: "prompt",
      session_id: "ses_idem",
      time: "2026-11-25T10:00:00.000Z",
      text: `Fix ${join("sk", "-ant-api03-", "9xYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_AA")} for ada@example.com with correct-horse-battery-staple and +1 (415) 555-2671`,
      files: ["src/auth.ts"],
    }
    const snapshotBefore = JSON.stringify(original)

    const first = redactRecord(original, { envValues })
    // Pure: original input is never mutated.
    expect(JSON.stringify(original)).toBe(snapshotBefore)
    expect(first.counts.anthropic_key).toBe(1)
    expect(first.counts.email).toBe(1)
    expect(first.counts.env_value).toBe(1)
    expect(first.counts.phone).toBe(1)

    const second = redactRecord(first.record, { envValues })
    expect(second.record).toEqual(first.record)
    expect(second.counts).toEqual({})
  })
})

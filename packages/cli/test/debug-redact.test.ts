import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-debug-redact-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe("pendix debug redact", () => {
  test("previews a redacted session record including local .env values and prints counts", async () => {
    const root = await makeTempDir()
    const dataDir = path.join(root, "data")
    const projectDir = path.join(root, "project")
    const sessionsDir = path.join(dataDir, "pendix", "sessions")
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })

    await writeFile(path.join(projectDir, ".env"), "LOCAL_SECRET=super-secret-env-token-99\n", "utf8")

    const sessionId = "ses_preview_123"
    const lines = [
      JSON.stringify({
        type: "start",
        session_id: sessionId,
        time: "2026-11-25T10:00:00.000Z",
        project_name: "project",
        provider: "google",
        model: "gemini-2.5-pro",
        teach_mode: false,
      }),
      JSON.stringify({
        type: "prompt",
        session_id: sessionId,
        time: "2026-11-25T10:00:01.000Z",
        text: "Email ada@example.com with super-secret-env-token-99 and ghp_1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7q8R",
        files: ["src/index.ts"],
      }),
    ]
    await writeFile(path.join(sessionsDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8")

    const child = Bun.spawn(
      [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "debug", "redact", sessionId, "--project", projectDir],
      {
        cwd: path.join(import.meta.dir, ".."),
        env: {
          ...process.env,
          XDG_DATA_HOME: dataDir,
          PENDIX_DISABLE_KEYCHAIN: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("[REDACTED:email]")
    expect(stdout).toContain("[REDACTED:env_value]")
    expect(stdout).toContain("[REDACTED:github_token]")
    expect(stdout).not.toContain("ada@example.com")
    expect(stdout).not.toContain("super-secret-env-token-99")
    expect(stdout).not.toContain("ghp_1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7q8R")
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-sessions-cmd-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe("pendix sessions command", () => {
  test("lists local, uploaded, and graded sessions with status and score", async () => {
    const root = await makeTempDir()
    const dataDir = path.join(root, "data")
    const configDir = path.join(root, "config")
    const sessionsDir = path.join(dataDir, "pendix", "sessions")
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(configDir, { recursive: true })

    // Local-only session on disk.
    await writeFile(
      path.join(sessionsDir, "ses_local_1.jsonl"),
      JSON.stringify({
        type: "start",
        session_id: "ses_local_1",
        time: "2026-11-25T09:00:00.000Z",
        project_name: "local-project",
        provider: "google",
        model: "gemini-2.5-pro",
        teach_mode: false,
      }) + "\n",
      "utf8",
    )

    // Fake API serving one uploaded (queued) and one graded session with a score.
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/sessions") {
          return Response.json({
            sessions: [
              {
                id: "remote-graded-1",
                project_title: "billing-app",
                status: "graded",
                score: 8.5,
                created_at: "2026-11-25T10:00:00.000Z",
              },
              {
                id: "remote-queued-2",
                project_title: "notes-app",
                status: "queued",
                score: null,
                created_at: "2026-11-25T09:30:00.000Z",
              },
            ],
          })
        }
        return new Response(null, { status: 404 })
      },
    })

    await writeFile(
      path.join(configDir, "auth.json"),
      JSON.stringify({ device_token: "pdx_dev_sessions_test" }) + "\n",
      { mode: 0o600 },
    )

    try {
      const child = Bun.spawn(
        [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "sessions"],
        {
          cwd: path.join(import.meta.dir, ".."),
          env: {
            ...process.env,
            XDG_DATA_HOME: dataDir,
            OPENCODE_CONFIG_DIR: configDir,
            PENDIX_API_URL: server.url.toString().replace(/\/$/, ""),
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
      expect(stdout).toContain("billing-app")
      expect(stdout).toContain("graded")
      expect(stdout).toContain("8.5/10")
      expect(stdout).toContain("notes-app")
      expect(stdout).toContain("uploaded")
      expect(stdout).toContain("local-project")
      expect(stdout).toContain("local")
    } finally {
      server.stop(true)
    }
  })
})

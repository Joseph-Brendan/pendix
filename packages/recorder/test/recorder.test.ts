import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSessionRecorder, extractCommandNames, type RecorderRecord } from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-recorder-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

async function readJsonl(filePath: string): Promise<RecorderRecord[]> {
  const raw = await readFile(filePath, "utf8")
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecorderRecord)
}

describe("@pendix/recorder", () => {
  it("records a simulated 3-prompt session with start, 3 prompts, 3 turns, teach Q&A, and end in order", async () => {
    const dataDir = await makeTempDir()
    let currentTime = new Date("2026-11-25T10:00:00.000Z").getTime()
    const recorder = createSessionRecorder({
      dataDir,
      now: () => currentTime,
    })

    const sessionId = "ses_3prompt_demo"
    const projectDir = "/Users/ada/secret-workspace/my-invoice-app"

    recorder.handleEngineEvent({
      type: "session.created",
      created: currentTime,
      data: {
        sessionID: sessionId,
        location: { directory: projectDir },
        model: { providerID: "google", id: "gemini-2.5-pro" },
        metadata: { teach_mode: true },
      },
    })

    for (let i = 1; i <= 3; i += 1) {
      currentTime += 1000
      recorder.handleEngineEvent({
        type: "session.inbox.enqueued",
        created: currentTime,
        data: {
          sessionID: sessionId,
          item: {
            type: "user",
            payload: {
              text: `Step ${i}: update @src/app.ts and check tests`,
              files: [{ name: `file${i}.ts`, source: { type: "inline" }, data: "c2VjcmV0X2ZpbGVfY29udGVudA==" }],
            },
          },
        },
      })

      currentTime += 500
      recorder.handleEngineEvent({
        type: "session.execution.started",
        created: currentTime,
        data: { sessionID: sessionId },
      })

      recorder.handleEngineEvent({
        type: "session.tool.input.started",
        created: currentTime,
        data: { sessionID: sessionId, id: `call_read_${i}`, name: "read" },
      })
      recorder.handleEngineEvent({
        type: "session.tool.called",
        created: currentTime,
        data: { sessionID: sessionId, id: `call_read_${i}`, input: { path: `${projectDir}/src/app.ts` } },
      })
      recorder.handleEngineEvent({
        type: "session.tool.success",
        created: currentTime,
        data: { sessionID: sessionId, id: `call_read_${i}` },
      })

      const longReply = `Completed step ${i}. ` + "x".repeat(600)
      recorder.handleEngineEvent({
        type: "session.text.ended",
        created: currentTime,
        data: { sessionID: sessionId, text: longReply },
      })

      currentTime += 500
      recorder.handleEngineEvent({
        type: "session.execution.succeeded",
        created: currentTime,
        data: { sessionID: sessionId },
      })
    }

    currentTime += 1000
    recorder.recordTeachQA(sessionId, {
      question: "Why did we use a transaction here?",
      answer: "So both writes commit together or roll back on error.",
    })

    currentTime += 1000
    recorder.endSession(sessionId, "quit")
    await recorder.flush()

    const records = await readJsonl(recorder.filePathFor(sessionId))
    expect(records.map((r) => r.type)).toEqual([
      "start",
      "prompt",
      "turn",
      "prompt",
      "turn",
      "prompt",
      "turn",
      "teach_qa",
      "end",
    ])

    const start = records[0]
    expect(start).toMatchObject({
      type: "start",
      session_id: sessionId,
      project_name: "my-invoice-app",
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: true,
    })
    // Full filesystem path must never be recorded.
    expect(JSON.stringify(records)).not.toContain("/Users/ada/secret-workspace")
    expect(JSON.stringify(records)).not.toContain("c2VjcmV0X2ZpbGVfY29udGVudA==")

    const firstPrompt = records[1]
    expect(firstPrompt?.type === "prompt" && firstPrompt.files).toEqual(["file1.ts", "src/app.ts"])

    const firstTurn = records[2]
    expect(firstTurn?.type === "turn" && firstTurn.tools).toEqual({ read: 1 })
    expect(firstTurn?.type === "turn" && firstTurn.errored).toBe(false)
    expect(firstTurn?.type === "turn" && firstTurn.reply_preview.length).toBe(500)

    const end = records[8]
    expect(end).toMatchObject({
      type: "end",
      session_id: sessionId,
      reason: "quit",
    })
  })

  it("stores `npm install stripe --save` as `npm` with no arguments or env values", async () => {
    expect(extractCommandNames("npm install stripe --save")).toEqual(["npm"])
    expect(extractCommandNames("STRIPE_KEY=sk_live_secret npm install stripe --save && git commit -m 'msg'")).toEqual([
      "npm",
      "git",
    ])
    expect(extractCommandNames("sudo -u root /usr/local/bin/bun test --watch")).toEqual(["bun"])

    const dataDir = await makeTempDir()
    const recorder = createSessionRecorder({ dataDir })
    const sessionId = "ses_cmd_test"

    recorder.handleEngineEvent({
      type: "session.created",
      data: { sessionID: sessionId, location: { directory: "/tmp/demo-app" } },
    })
    recorder.handleEngineEvent({
      type: "session.execution.started",
      data: { sessionID: sessionId },
    })
    recorder.handleEngineEvent({
      type: "session.tool.input.started",
      data: { sessionID: sessionId, id: "call_sh_1", name: "shell" },
    })
    recorder.handleEngineEvent({
      type: "session.tool.called",
      data: {
        sessionID: sessionId,
        id: "call_sh_1",
        input: { command: "npm install stripe --save" },
      },
    })
    recorder.handleEngineEvent({
      type: "session.tool.success",
      data: { sessionID: sessionId, id: "call_sh_1" },
    })
    recorder.handleEngineEvent({
      type: "session.execution.succeeded",
      data: { sessionID: sessionId },
    })
    recorder.endSession(sessionId, "quit")
    await recorder.flush()

    const records = await readJsonl(recorder.filePathFor(sessionId))
    const turn = records.find((r) => r.type === "turn")
    expect(turn).toBeDefined()
    expect(turn?.type === "turn" && turn.commands).toEqual(["npm"])
    expect(turn?.type === "turn" && turn.tools).toEqual({ shell: 1 })
    const raw = JSON.stringify(records)
    expect(raw).not.toContain("stripe")
    expect(raw).not.toContain("--save")
  })

  it("stores relative path and line counts for file writes and edits, never file content", async () => {
    const dataDir = await makeTempDir()
    const recorder = createSessionRecorder({ dataDir })
    const sessionId = "ses_write_test"
    const secretContent = "const SUPER_SECRET_CONTENT = 'top-secret-value-999'\nconsole.log(SUPER_SECRET_CONTENT)\n"

    recorder.handleEngineEvent({
      type: "session.created",
      data: { sessionID: sessionId, location: { directory: "/workspace/my-project" } },
    })
    recorder.handleEngineEvent({
      type: "session.execution.started",
      data: { sessionID: sessionId },
    })

    // Write tool call (no diff metadata -> counts lines from content, drops content).
    recorder.handleEngineEvent({
      type: "session.tool.input.started",
      data: { sessionID: sessionId, id: "call_w1", name: "write" },
    })
    recorder.handleEngineEvent({
      type: "session.tool.called",
      data: {
        sessionID: sessionId,
        id: "call_w1",
        input: {
          path: "/workspace/my-project/src/secret.ts",
          content: secretContent,
        },
      },
    })
    recorder.handleEngineEvent({
      type: "session.tool.success",
      data: { sessionID: sessionId, id: "call_w1" },
    })

    // Edit tool call with FileDiff metadata (must drop patch contents, keep path & line counts).
    recorder.handleEngineEvent({
      type: "session.tool.input.started",
      data: { sessionID: sessionId, id: "call_e1", name: "edit" },
    })
    recorder.handleEngineEvent({
      type: "session.tool.called",
      data: {
        sessionID: sessionId,
        id: "call_e1",
        input: {
          path: "/workspace/my-project/src/index.ts",
          oldString: "OLD_SECRET_LINE",
          newString: "NEW_SECRET_LINE_1\nNEW_SECRET_LINE_2",
        },
      },
    })
    recorder.handleEngineEvent({
      type: "session.tool.success",
      data: {
        sessionID: sessionId,
        id: "call_e1",
        metadata: {
          files: [
            {
              file: "src/index.ts",
              patch: "--- a/src/index.ts\n+++ b/src/index.ts\n-OLD_SECRET_LINE\n+NEW_SECRET_LINE_1",
              additions: 2,
              deletions: 1,
              status: "modified",
            },
          ],
        },
      },
    })

    recorder.handleEngineEvent({
      type: "session.execution.succeeded",
      data: { sessionID: sessionId },
    })
    recorder.endSession(sessionId, "quit")
    await recorder.flush()

    const records = await readJsonl(recorder.filePathFor(sessionId))
    const turn = records.find((r) => r.type === "turn")
    expect(turn?.type === "turn" && turn.files_changed).toEqual([
      { path: "src/secret.ts", lines_added: 2, lines_removed: 0 },
      { path: "src/index.ts", lines_added: 2, lines_removed: 1 },
    ])

    const raw = JSON.stringify(records)
    expect(raw).not.toContain("SUPER_SECRET_CONTENT")
    expect(raw).not.toContain("top-secret-value-999")
    expect(raw).not.toContain("OLD_SECRET_LINE")
    expect(raw).not.toContain("NEW_SECRET_LINE_1")
  })

  it("does not crash or stop the agent when disk writes fail, and logs the error", async () => {
    const dataDir = await makeTempDir()
    const loggedErrors: unknown[] = []
    const recorder = createSessionRecorder({
      dataDir,
      appendFile: async () => {
        throw new Error("ENOSPC: no space left on device")
      },
      onError: (err) => {
        loggedErrors.push(err)
      },
    })

    const sessionId = "ses_disk_fail"
    expect(() => {
      recorder.handleEngineEvent({
        type: "session.created",
        data: { sessionID: sessionId, location: { directory: "/workspace/app" } },
      })
      recorder.handleEngineEvent({
        type: "session.inbox.enqueued",
        data: {
          sessionID: sessionId,
          item: { type: "user", payload: { text: "Hello" } },
        },
      })
      recorder.endSession(sessionId, "quit")
    }).not.toThrow()

    await expect(recorder.flush()).resolves.toBeUndefined()
    expect(loggedErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("records 1,000 events in under 200 ms total", async () => {
    const dataDir = await makeTempDir()
    const recorder = createSessionRecorder({ dataDir })
    const sessionId = "ses_perf_1000"

    const startedAt = performance.now()
    recorder.handleEngineEvent({
      type: "session.created",
      data: { sessionID: sessionId, location: { directory: "/workspace/perf-app" } },
    })

    // 499 prompts + 499 turns + start + end = 1,000 JSONL records.
    for (let i = 0; i < 499; i += 1) {
      recorder.handleEngineEvent({
        type: "session.inbox.enqueued",
        data: {
          sessionID: sessionId,
          item: { type: "user", payload: { text: `Prompt ${i}` } },
        },
      })
      recorder.handleEngineEvent({
        type: "session.execution.started",
        data: { sessionID: sessionId },
      })
      recorder.handleEngineEvent({
        type: "session.text.ended",
        data: { sessionID: sessionId, text: `Reply ${i}` },
      })
      recorder.handleEngineEvent({
        type: "session.execution.succeeded",
        data: { sessionID: sessionId },
      })
    }

    recorder.endSession(sessionId, "quit")
    await recorder.flush()
    const elapsedMs = performance.now() - startedAt

    const records = await readJsonl(recorder.filePathFor(sessionId))
    expect(records).toHaveLength(1000)
    expect(elapsedMs).toBeLessThan(200)
  })
})

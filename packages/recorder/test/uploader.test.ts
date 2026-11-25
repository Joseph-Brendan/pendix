import { afterEach, describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { entitlementsFor } from "@pendix/shared/plans"
import {
  createRecorderStateStore,
  drainUploadQueue,
  handleSessionEnd,
  LOCAL_RETENTION_AFTER_UPLOAD_MS,
  type RecorderRecord,
} from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-uploader-test-"))
  tempDirs.push(dir)
  return dir
}

async function writeSampleSession(dataDir: string, sessionId: string, projectName = "my-app") {
  const sessionsDir = path.join(dataDir, "sessions")
  await mkdir(sessionsDir, { recursive: true })
  const records: RecorderRecord[] = [
    {
      type: "start",
      session_id: sessionId,
      time: "2026-11-25T10:00:00.000Z",
      project_name: projectName,
      provider: "google",
      model: "gemini-2.5-pro",
      teach_mode: false,
    },
    {
      type: "prompt",
      session_id: sessionId,
      time: "2026-11-25T10:00:01.000Z",
      text: "Add unit tests for checkout",
      files: ["src/checkout.ts"],
    },
    {
      type: "turn",
      session_id: sessionId,
      time: "2026-11-25T10:00:05.000Z",
      tools: { write: 1 },
      files_changed: [{ path: "test/checkout.test.ts", lines_added: 25, lines_removed: 0 }],
      commands: ["vitest"],
      errored: false,
      reply_preview: "Added checkout unit tests.",
    },
    {
      type: "end",
      session_id: sessionId,
      time: "2026-11-25T10:01:00.000Z",
      reason: "quit",
    },
  ]
  const filePath = path.join(sessionsDir, `${sessionId}.jsonl`)
  await writeFile(filePath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8")
  return filePath
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe("session upload flow, consent, entitlements, and persistent queue", () => {
  it("subscriber with consent uploads automatically on session end", async () => {
    const dataDir = await makeTempDir()
    await writeSampleSession(dataDir, "ses_sub_1")
    const stateStore = createRecorderStateStore(dataDir)
    const now = () => new Date("2026-11-25T10:05:00.000Z").getTime()

    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const fetchFn = async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      requests.push({ url, method: init?.method ?? "GET", body })
      if (url.endsWith("/consents/grading")) {
        return Response.json({ ok: true, kind: "grading", version: "2026-01" }, { status: 201 })
      }
      if (url.endsWith("/sessions")) {
        return Response.json({ id: "remote-ses-1", status: "queued" }, { status: 201 })
      }
      return new Response(null, { status: 404 })
    }

    let consentPromptCount = 0
    const first = await handleSessionEnd({
      sessionId: "ses_sub_1",
      projectKey: "my-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account: {
        plan: "solo",
        credits: 0,
        entitlements: entitlementsFor("solo"),
      },
      now,
      fetchFn,
      sleep: async () => {},
      promptConsent: async (copy) => {
        consentPromptCount += 1
        expect(copy.toLowerCase()).toContain("never sent")
        return true
      },
    })

    expect(first.action).toBe("uploaded")
    expect(consentPromptCount).toBe(1)
    expect(requests.some((r) => r.url.endsWith("/consents/grading"))).toBe(true)
    expect(requests.some((r) => r.url.endsWith("/sessions"))).toBe(true)
    expect(stateStore.load().grading_consent?.granted).toBe(true)
    expect(stateStore.load().uploaded_sessions["ses_sub_1"]?.remote_id).toBe("remote-ses-1")

    // Second session does not ask for consent again.
    await writeSampleSession(dataDir, "ses_sub_2")
    const second = await handleSessionEnd({
      sessionId: "ses_sub_2",
      projectKey: "my-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account: {
        plan: "solo",
        credits: 0,
        entitlements: entitlementsFor("solo"),
      },
      now,
      fetchFn,
      sleep: async () => {},
      promptConsent: async () => {
        consentPromptCount += 1
        return true
      },
    })
    expect(second.action).toBe("uploaded")
    expect(consentPromptCount).toBe(1)
  })

  it("credit holder: choosing No uploads nothing; Always for this project skips the question next time", async () => {
    const dataDir = await makeTempDir()
    const stateStore = createRecorderStateStore(dataDir)
    stateStore.save({
      ...stateStore.load(),
      grading_consent: { granted: true, version: "2026-01", granted_at: "2026-11-25T09:00:00.000Z", synced: true },
    })

    const uploadedIds: string[] = []
    const fetchFn = async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.endsWith("/sessions")) {
        const body = JSON.parse(String(init?.body)) as { local_session_id: string }
        uploadedIds.push(body.local_session_id)
        return Response.json({ id: `remote-${body.local_session_id}`, status: "queued" }, { status: 201 })
      }
      return new Response(null, { status: 404 })
    }

    const account = {
      plan: "free" as const,
      credits: 4,
      entitlements: entitlementsFor("free"),
    }

    // 1. Choosing No uploads nothing.
    await writeSampleSession(dataDir, "ses_cred_no")
    let promptSeen = ""
    const declined = await handleSessionEnd({
      sessionId: "ses_cred_no",
      projectKey: "shop-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      fetchFn,
      sleep: async () => {},
      promptCreditChoice: async (info) => {
        promptSeen = info.message
        return "no"
      },
    })
    expect(promptSeen).toBe("Grade this session? Uses 1 credit. You have 4.")
    expect(declined.action).toBe("declined_credit")
    expect(uploadedIds).toEqual([])

    // 2. Choosing "Always for this project" uploads and saves preference.
    await writeSampleSession(dataDir, "ses_cred_always_1")
    let creditPromptCount = 0
    const always1 = await handleSessionEnd({
      sessionId: "ses_cred_always_1",
      projectKey: "shop-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      fetchFn,
      sleep: async () => {},
      promptCreditChoice: async () => {
        creditPromptCount += 1
        return "always"
      },
    })
    expect(always1.action).toBe("uploaded")
    expect(creditPromptCount).toBe(1)
    expect(uploadedIds).toEqual(["ses_cred_always_1"])

    // 3. Next session in the same project skips the question and uploads automatically.
    await writeSampleSession(dataDir, "ses_cred_always_2")
    const always2 = await handleSessionEnd({
      sessionId: "ses_cred_always_2",
      projectKey: "shop-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      fetchFn,
      sleep: async () => {},
      promptCreditChoice: async () => {
        creditPromptCount += 1
        return "yes"
      },
    })
    expect(always2.action).toBe("uploaded")
    expect(creditPromptCount).toBe(1)
    expect(uploadedIds).toEqual(["ses_cred_always_1", "ses_cred_always_2"])
  })

  it("free user with no credits gets nudged at most once a day and uploads nothing", async () => {
    const dataDir = await makeTempDir()
    const stateStore = createRecorderStateStore(dataDir)
    let currentTime = new Date("2026-11-25T10:00:00.000Z").getTime()
    let uploadCalls = 0
    const fetchFn = async () => {
      uploadCalls += 1
      return Response.json({ id: "should-not-happen" }, { status: 201 })
    }

    const account = {
      plan: "free" as const,
      credits: 0,
      entitlements: entitlementsFor("free"),
    }

    await writeSampleSession(dataDir, "ses_free_1")
    const out1: string[] = []
    const res1 = await handleSessionEnd({
      sessionId: "ses_free_1",
      projectKey: "my-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      now: () => currentTime,
      fetchFn,
      write: (text) => out1.push(text),
    })
    expect(res1.action).toBe("nudged")
    expect(out1.join("")).toContain("Get this session graded: buy credits or subscribe")
    expect(out1.join("")).toContain("https://app.pendix.dev")
    expect(uploadCalls).toBe(0)

    // Same day, second session -> no second nudge, nothing uploaded.
    currentTime += 2 * 60 * 60 * 1000
    await writeSampleSession(dataDir, "ses_free_2")
    const out2: string[] = []
    const res2 = await handleSessionEnd({
      sessionId: "ses_free_2",
      projectKey: "my-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      now: () => currentTime,
      fetchFn,
      write: (text) => out2.push(text),
    })
    expect(res2.action).toBe("skipped_free")
    expect(out2.join("")).toBe("")
    expect(uploadCalls).toBe(0)

    // Next day -> nudged once again, still nothing uploaded.
    currentTime += 24 * 60 * 60 * 1000
    await writeSampleSession(dataDir, "ses_free_3")
    const out3: string[] = []
    const res3 = await handleSessionEnd({
      sessionId: "ses_free_3",
      projectKey: "my-app",
      dataDir,
      stateStore,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account,
      now: () => currentTime,
      fetchFn,
      write: (text) => out3.push(text),
    })
    expect(res3.action).toBe("nudged")
    expect(out3.join("")).toContain("Get this session graded: buy credits or subscribe")
    expect(uploadCalls).toBe(0)
  })

  it("when network is down, record stays queued across restarts, uploads on next start, and local copy is deleted after 30 days", async () => {
    const dataDir = await makeTempDir()
    const filePath = await writeSampleSession(dataDir, "ses_offline_queue")
    let currentTime = new Date("2026-11-25T10:00:00.000Z").getTime()

    const store1 = createRecorderStateStore(dataDir)
    store1.save({
      ...store1.load(),
      grading_consent: { granted: true, version: "2026-01", granted_at: "2026-11-25T09:00:00.000Z", synced: true },
    })

    const backoffDelays: number[] = []
    const downFetch = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED")
    }

    const firstAttempt = await handleSessionEnd({
      sessionId: "ses_offline_queue",
      projectKey: "my-app",
      dataDir,
      stateStore: store1,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      account: {
        plan: "mentored",
        credits: 0,
        entitlements: entitlementsFor("mentored"),
      },
      now: () => currentTime,
      fetchFn: downFetch,
      sleep: async (ms) => {
        backoffDelays.push(ms)
      },
    })

    expect(firstAttempt.action).toBe("queued")
    expect(backoffDelays.length).toBeGreaterThanOrEqual(1)

    // Simulate a fresh restart by creating a new state store from the same dataDir.
    const store2 = createRecorderStateStore(dataDir)
    expect(store2.load().upload_queue).toHaveLength(1)

    let uploadedOnRestart = false
    const upFetch = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.endsWith("/sessions")) {
        uploadedOnRestart = true
        return Response.json({ id: "remote-after-restart", status: "queued" }, { status: 201 })
      }
      return new Response(null, { status: 404 })
    }

    const drained = await drainUploadQueue({
      dataDir,
      stateStore: store2,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      now: () => currentTime,
      fetchFn: upFetch,
      sleep: async () => {},
    })
    expect(uploadedOnRestart).toBe(true)
    expect(drained.uploaded).toBe(1)
    expect(store2.load().upload_queue).toHaveLength(0)
    expect(existsSync(filePath)).toBe(true)

    // Advance 31 days -> next drain deletes local copy older than 30 days after upload.
    currentTime += LOCAL_RETENTION_AFTER_UPLOAD_MS + 24 * 60 * 60 * 1000
    const cleaned = await drainUploadQueue({
      dataDir,
      stateStore: store2,
      apiUrl: "http://127.0.0.1:3001",
      authToken: "pdx_dev_token",
      now: () => currentTime,
      fetchFn: upFetch,
      sleep: async () => {},
    })
    expect(cleaned.deletedLocalFiles).toBe(1)
    expect(existsSync(filePath)).toBe(false)
  })
})

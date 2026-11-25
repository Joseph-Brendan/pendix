import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { entitlementsFor } from "@pendix/shared/plans"
import { DEFAULT_PENDIX_API_URL, PENDIX_DOMAIN, resolvePendixApiUrl } from "@pendix/shared/urls"
import { ensureSignedIn, logoutPendix, whoamiPendix } from "../src/pendix-auth/client"
import { createAuthStorage, type KeychainBackend } from "../src/pendix-auth/storage"

interface FakeCloudState {
  approved: boolean
  meStatus: number
  deviceToken: string
  refreshToken: string
  deviceId: string
  userCode: string
  displayName: string
  plan: "free" | "solo" | "mentored"
  credits: number
  teachLock: "none" | "self" | "class"
  startCount: number
  tokenPollCount: number
  meCount: number
  revokedIds: string[]
}

function startFakeCloudApi(initial?: Partial<FakeCloudState>) {
  const state: FakeCloudState = {
    approved: false,
    meStatus: 200,
    deviceToken: "pdx_dev_test_token_123456",
    refreshToken: "pdx_ref_test_refresh_123456",
    deviceId: "11111111-1111-4111-8111-111111111111",
    userCode: "ABCD2345",
    displayName: "Ada Learner",
    plan: "solo",
    credits: 7,
    teachLock: "none",
    startCount: 0,
    tokenPollCount: 0,
    meCount: 0,
    revokedIds: [],
    ...initial,
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)

      if (request.method === "POST" && url.pathname === "/device/start") {
        state.startCount += 1
        return Response.json({
          device_code: "dev_code_secret_xyz",
          user_code: state.userCode,
          verification_url: `${url.origin}/device/verify?code=${state.userCode}`,
          interval: 1,
          expires_in: 600,
        })
      }

      if (request.method === "POST" && url.pathname === "/device/token") {
        state.tokenPollCount += 1
        if (!state.approved) {
          return Response.json(
            { error: "authorization_pending", error_description: "Waiting for approval." },
            { status: 400 },
          )
        }
        return Response.json({
          device_id: state.deviceId,
          device_name: "Test, terminal",
          token_type: "Bearer",
          access_token: state.deviceToken,
          device_token: state.deviceToken,
          refresh_token: state.refreshToken,
          expires_in: 7776000,
        })
      }

      if (request.method === "GET" && url.pathname === "/me") {
        state.meCount += 1
        const auth = request.headers.get("authorization")
        if (state.meStatus === 401 || auth !== `Bearer ${state.deviceToken}`) {
          return Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required" } }, { status: 401 })
        }
        return Response.json({
          id: "22222222-2222-4222-8222-222222222222",
          display_name: state.displayName,
          email: "ada@example.com",
          account_kind: "adult",
          status: "active",
          plan: state.plan,
          entitlements: entitlementsFor(state.plan),
          teach_lock: state.teachLock,
          credits: state.credits,
        })
      }

      if (request.method === "DELETE" && url.pathname.startsWith("/devices/")) {
        state.revokedIds.push(url.pathname.slice("/devices/".length))
        return Response.json({ ok: true, revoked: true })
      }

      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 })
    },
  })

  return {
    state,
    url: server.url.toString().replace(/\/$/, ""),
    stop: () => server.stop(true),
  }
}

const noKeychain: KeychainBackend = {
  available: () => false,
  get: () => undefined,
  set: () => false,
  delete: () => false,
}

const tempDirs: string[] = []

async function makeTempConfigDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pendix-auth-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe("Pendix terminal sign-in gate and commands", () => {
  test("API URL defaults to https://api.pendix.dev and honors PENDIX_API_URL", () => {
    expect(PENDIX_DOMAIN).toBe("pendix.dev")
    expect(DEFAULT_PENDIX_API_URL).toBe("https://api.pendix.dev")
    expect(resolvePendixApiUrl({})).toBe("https://api.pendix.dev")
    expect(resolvePendixApiUrl({ PENDIX_API_URL: "http://127.0.0.1:3001/" })).toBe("http://127.0.0.1:3001")
  })

  test("first run shows sign-in with large code and opens browser; approval stores a 0600 token; second run skips sign-in", async () => {
    const configDir = await makeTempConfigDir()
    const api = startFakeCloudApi()
    const output: string[] = []
    const openedUrls: string[] = []
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()

    try {
      const storage = createAuthStorage({ configDir, keychain: noKeychain })

      // First run: no token -> shows sign-in screen, polls until approved, stores token and caches /me.
      const first = await ensureSignedIn({
        apiUrl: api.url,
        storage,
        env: { DISPLAY: ":0" },
        platform: "darwin",
        now: () => currentTime,
        write: (text) => output.push(text),
        openBrowser: async (url) => {
          openedUrls.push(url)
        },
        sleep: async () => {
          // Approve after first authorization_pending poll.
          api.state.approved = true
        },
      })

      expect(first.ok).toBe(true)
      if (!first.ok) throw new Error("Expected first run to succeed")
      expect(first.offline).toBe(false)
      expect(first.account.display_name).toBe("Ada Learner")
      expect(first.account.plan).toBe("solo")
      expect(api.state.startCount).toBe(1)
      expect(api.state.tokenPollCount).toBe(2)

      const rendered = output.join("")
      expect(rendered).toContain("ABCD2345")
      expect(rendered).toContain(`${api.url}/device/verify?code=ABCD2345`)
      expect(rendered).toContain("Opening your browser...")
      expect(openedUrls).toEqual([`${api.url}/device/verify?code=ABCD2345`])

      // Token file fallback has mode 0600 on POSIX (Windows NTFS ACL equivalent is documented in storage.ts).
      if (process.platform !== "win32") {
        const info = await stat(storage.tokenFilePath)
        expect(info.mode & 0o777).toBe(0o600)
      }

      // Second run: skips sign-in completely.
      const secondOutput: string[] = []
      const second = await ensureSignedIn({
        apiUrl: api.url,
        storage,
        env: {},
        platform: "darwin",
        now: () => currentTime,
        write: (text) => secondOutput.push(text),
        openBrowser: async () => {
          throw new Error("Should not open browser on second run")
        },
      })

      expect(second.ok).toBe(true)
      if (!second.ok) throw new Error("Expected second run to succeed")
      expect(second.offline).toBe(false)
      expect(second.account.display_name).toBe("Ada Learner")
      expect(api.state.startCount).toBe(1)
      expect(secondOutput.join("")).not.toContain("Opening your browser...")
    } finally {
      api.stop()
    }
  })

  test("over SSH, sign-in prints the URL without trying to open a browser", async () => {
    const configDir = await makeTempConfigDir()
    const api = startFakeCloudApi({ approved: true })
    const output: string[] = []
    const openedUrls: string[] = []

    try {
      const storage = createAuthStorage({ configDir, keychain: noKeychain })
      const result = await ensureSignedIn({
        apiUrl: api.url,
        storage,
        env: { SSH_CONNECTION: "10.0.0.1 55555 10.0.0.2 22" },
        platform: "linux",
        write: (text) => output.push(text),
        openBrowser: async (url) => {
          openedUrls.push(url)
        },
      })
      expect(result.ok).toBe(true)
      expect(openedUrls).toEqual([])
      const text = output.join("")
      expect(text).toContain(`${api.url}/device/verify?code=ABCD2345`)
      expect(text).not.toContain("Opening your browser...")
    } finally {
      api.stop()
    }
  })

  test("logout removes the token and whoami then reports not signed in", async () => {
    const configDir = await makeTempConfigDir()
    const api = startFakeCloudApi({ approved: true })

    try {
      const storage = createAuthStorage({ configDir, keychain: noKeychain })
      const signedIn = await ensureSignedIn({
        apiUrl: api.url,
        storage,
        env: { SSH_TTY: "/dev/pts/0" },
        write: () => {},
      })
      expect(signedIn.ok).toBe(true)

      const before = await whoamiPendix({ apiUrl: api.url, storage })
      expect(before.signedIn).toBe(true)
      if (!before.signedIn) throw new Error("Expected signed in")
      expect(before.account.display_name).toBe("Ada Learner")
      expect(before.account.plan).toBe("solo")
      expect(before.account.credits).toBe(7)

      const out = await logoutPendix({ apiUrl: api.url, storage })
      expect(out.hadToken).toBe(true)
      expect(storage.loadToken()).toBeUndefined()
      expect(storage.loadMeCache()).toBeUndefined()
      expect(api.state.revokedIds).toEqual([api.state.deviceId])

      const after = await whoamiPendix({ apiUrl: api.url, storage })
      expect(after.signedIn).toBe(false)
      if (after.signedIn) throw new Error("Expected signed out")
      expect(after.message.toLowerCase()).toContain("not signed in")
    } finally {
      api.stop()
    }
  })

  test("offline with a fresh cache under 7 days runs in offline mode without paid features; offline with no cache explains internet is needed and does not start", async () => {
    const configDir = await makeTempConfigDir()
    const emptyConfigDir = await makeTempConfigDir()
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const api = startFakeCloudApi({ approved: true, plan: "mentored" })

    const storage = createAuthStorage({ configDir, keychain: noKeychain })
    const initial = await ensureSignedIn({
      apiUrl: api.url,
      storage,
      env: { SSH_TTY: "/dev/pts/0" },
      now: () => currentTime,
      write: () => {},
    })
    expect(initial.ok).toBe(true)
    api.stop()

    // 3 days later, API is unreachable -> offline mode with paid features disabled.
    currentTime += 3 * 24 * 60 * 60 * 1000
    const offlineWithCache = await ensureSignedIn({
      apiUrl: api.url,
      storage,
      now: () => currentTime,
      write: () => {},
    })
    expect(offlineWithCache.ok).toBe(true)
    if (!offlineWithCache.ok) throw new Error("Expected offline run with fresh cache to succeed")
    expect(offlineWithCache.offline).toBe(true)
    expect(offlineWithCache.account.display_name).toBe("Ada Learner")
    expect(offlineWithCache.account.entitlements.agent).toBe(true)
    expect(offlineWithCache.account.entitlements.grading).toBe(false)
    expect(offlineWithCache.account.entitlements.notes).toBe(false)
    expect(offlineWithCache.account.entitlements.assessments).toBe(false)
    expect(offlineWithCache.account.entitlements.humanMentor).toBe(false)

    // 8 days later (cache older than 7 days) -> refused.
    currentTime += 5 * 24 * 60 * 60 * 1000
    const staleOut: string[] = []
    const offlineStale = await ensureSignedIn({
      apiUrl: api.url,
      storage,
      now: () => currentTime,
      write: (text) => staleOut.push(text),
    })
    expect(offlineStale.ok).toBe(false)

    // No cache at all + unreachable API -> prints clear message and does not start.
    const emptyStorage = createAuthStorage({ configDir: emptyConfigDir, keychain: noKeychain })
    const noCacheOut: string[] = []
    const offlineNoCache = await ensureSignedIn({
      apiUrl: api.url,
      storage: emptyStorage,
      now: () => currentTime,
      write: (text) => noCacheOut.push(text),
    })
    expect(offlineNoCache.ok).toBe(false)
    if (offlineNoCache.ok) throw new Error("Expected offline run with no cache to fail")
    expect(offlineNoCache.reason).toBe("offline_no_cache")
    expect(noCacheOut.join("").toLowerCase()).toContain("internet")
  })

  test("a 401 from /me clears the invalid token and sends the user back to sign-in", async () => {
    const configDir = await makeTempConfigDir()
    const api = startFakeCloudApi({
      approved: true,
      deviceToken: "pdx_dev_new_valid_token",
    })
    const output: string[] = []

    try {
      const storage = createAuthStorage({ configDir, keychain: noKeychain })
      // Store an old revoked token that will get 401 from /me.
      storage.saveToken({
        device_token: "pdx_dev_revoked_token",
        refresh_token: "pdx_ref_old",
        device_id: "33333333-3333-4333-8333-333333333333",
        api_url: api.url,
      })

      const result = await ensureSignedIn({
        apiUrl: api.url,
        storage,
        env: { SSH_TTY: "/dev/pts/0" },
        write: (text) => output.push(text),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("Expected re-auth after 401 to succeed")
      expect(api.state.startCount).toBe(1)
      expect(output.join("")).toContain("ABCD2345")
      expect(storage.loadToken()?.device_token).toBe("pdx_dev_new_valid_token")
    } finally {
      api.stop()
    }
  })

  test("CLI whoami prints not signed in when logged out", async () => {
    const configDir = await makeTempConfigDir()
    const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "whoami"], {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: configDir,
        PENDIX_DISABLE_KEYCHAIN: "1",
        PENDIX_API_URL: "http://127.0.0.1:1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode).toBe(1)
    expect((stdout + stderr).toLowerCase()).toContain("not signed in")
  })
})

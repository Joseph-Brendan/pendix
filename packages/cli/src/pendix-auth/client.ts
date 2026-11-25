import os from "node:os"
import { resolvePendixApiUrl } from "@pendix/shared/urls"
import { openUrl } from "@pendix/util/open"
import {
  isMeCacheUsableOffline,
  ME_CACHE_FRESH_MS,
  parseMePayload,
  toOfflineAccount,
  type AuthStorage,
  type CachedMe,
  type StoredDeviceToken,
} from "./storage"

const REQUEST_TIMEOUT_MS = 5_000

const BIG_FONT: Readonly<Record<string, readonly [string, string, string]>> = {
  A: [" /\\ ", "/__\\", "|  |"],
  B: ["|--.", "|--<", "|__/"],
  C: [" .--", "|   ", " `--"],
  D: ["|--.", "|  |", "|__/"],
  E: ["----", "|-- ", "----"],
  F: ["----", "|-- ", "|   "],
  G: [" .--", "| -.", " `--"],
  H: ["|  |", "|--|", "|  |"],
  J: ["  --", "   |", "\\__/"],
  K: ["| / ", "|<  ", "| \\ "],
  M: ["|\\ /|", "| V |", "|   |"],
  N: ["|\\ |", "| \\|", "|  |"],
  P: ["|--.", "|--'", "|   "],
  Q: [" .-. ", "| | |", " `-\\"],
  R: ["|--.", "|--'", "| \\ "],
  S: [" .--", " --.", "---'"],
  T: ["----", " || ", " || "],
  U: ["|  |", "|  |", "\\__/"],
  V: ["\\  /", " \\/ ", "  v "],
  W: ["|   |", "| ^ |", "|/ \\|"],
  X: ["\\ / ", " X  ", "/ \\ "],
  Y: ["\\ / ", " |  ", " |  "],
  Z: ["----", "  / ", "----"],
  "2": [" --.", " .-/", "----"],
  "3": [" --.", " --<", " --'"],
  "4": ["|  |", "----", "   |"],
  "5": ["----", "---.", "---'"],
  "6": [" .--", "|--.", "\\__/"],
  "7": ["----", "  / ", " /  "],
  "8": [" .-. ", " >-< ", " `-' "],
  "9": [" .-. ", "`--|", " --'"],
  "-": ["    ", " -- ", "    "],
}

export function renderLargeUserCode(code: string): string {
  const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
  const chars = [...formatted.toUpperCase()]
  const lines = [0, 1, 2].map((row) =>
    chars.map((char) => (BIG_FONT[char] ? BIG_FONT[char][row] : ` ${char}  `)).join("  "),
  )
  return lines.join("\n")
}

export function canOpenBrowser(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return false
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false
  return true
}

export function defaultDeviceName(): string {
  const host = os.hostname().replace(/\.local$/i, "").trim()
  return host ? `${host}, terminal` : "terminal"
}

export interface PendixAuthOptions {
  readonly storage: AuthStorage
  readonly apiUrl?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  readonly now?: () => number
  readonly fetchFn?: typeof fetch
  readonly write?: (text: string) => void
  readonly openBrowser?: (url: string) => Promise<void>
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly signal?: AbortSignal
  readonly requestTimeoutMs?: number
}

export type EnsureSignedInResult =
  | {
      readonly ok: true
      readonly offline: boolean
      readonly account: CachedMe
      readonly token: StoredDeviceToken
      readonly startBackgroundRefresh: (handlers: {
        readonly onUpdate: (next: { readonly account: CachedMe; readonly offline: boolean }) => void
        readonly onUnauthorized: () => void
      }) => () => void
    }
  | {
      readonly ok: false
      readonly reason: "offline_no_cache" | "offline_cache_expired" | "sign_in_failed" | "cancelled"
      readonly message: string
    }

export type WhoamiResult =
  | { readonly signedIn: true; readonly offline: boolean; readonly account: CachedMe }
  | { readonly signedIn: false; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Cancelled")
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await fetchFn(url, { ...init, signal: combined })
  const text = await response.text()
  let body: unknown = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  return { status: response.status, body }
}

async function fetchMe(options: {
  readonly fetchFn: typeof fetch
  readonly apiUrl: string
  readonly token: string
  readonly now: () => number
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}): Promise<
  | { readonly kind: "ok"; readonly account: CachedMe }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "error"; readonly message: string }
> {
  try {
    const { status, body } = await fetchJson(
      options.fetchFn,
      `${options.apiUrl}/me`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${options.token}` },
      },
      options.timeoutMs,
      options.signal,
    )
    if (status === 401) return { kind: "unauthorized" }
    if (status !== 200) {
      return { kind: "error", message: `Pendix API returned status ${status}.` }
    }
    const account = parseMePayload(body, options.now())
    if (!account) return { kind: "error", message: "Received an invalid response from Pendix." }
    return { kind: "ok", account }
  } catch {
    return { kind: "unreachable" }
  }
}

export async function loginPendix(options: PendixAuthOptions): Promise<EnsureSignedInResult> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const apiUrl = options.apiUrl ?? resolvePendixApiUrl(env)
  const now = options.now ?? (() => Date.now())
  const fetchFn = options.fetchFn ?? fetch
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const openBrowser =
    options.openBrowser ??
    (async (url: string) => {
      await openUrl(url)
    })
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS

  let started: {
    readonly device_code: string
    readonly user_code: string
    readonly verification_url: string
    readonly interval: number
    readonly expires_in: number
  }
  try {
    const { status, body } = await fetchJson(
      fetchFn,
      `${apiUrl}/device/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: defaultDeviceName() }),
      },
      timeoutMs,
      options.signal,
    )
    if (
      status !== 200 ||
      !isRecord(body) ||
      typeof body.device_code !== "string" ||
      typeof body.user_code !== "string" ||
      typeof body.verification_url !== "string"
    ) {
      const message = "Could not start Pendix sign-in. Try again in a moment."
      write(`${message}\n`)
      return { ok: false, reason: "sign_in_failed", message }
    }
    started = {
      device_code: body.device_code,
      user_code: body.user_code,
      verification_url: body.verification_url,
      interval: typeof body.interval === "number" && body.interval > 0 ? body.interval : 5,
      expires_in: typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 600,
    }
  } catch {
    const message = "Cannot reach Pendix right now. Your first sign-in needs an internet connection."
    write(`${message}\n`)
    return { ok: false, reason: "offline_no_cache", message }
  }

  write("\n● pendix\n\n")
  write("Sign in to start Pendix.\n\n")
  write(`${renderLargeUserCode(started.user_code)}\n\n`)
  write(`Code: ${started.user_code}\n`)
  write(`URL:  ${started.verification_url}\n\n`)

  if (canOpenBrowser(env, platform)) {
    write("Opening your browser...\n")
    await openBrowser(started.verification_url).catch(() => {
      write(`Open this URL in your browser: ${started.verification_url}\n`)
    })
  } else {
    write("Open this URL in your browser to finish signing in.\n")
  }

  let intervalSeconds = started.interval
  const deadline = now() + started.expires_in * 1000

  while (now() <= deadline) {
    if (options.signal?.aborted) {
      return { ok: false, reason: "cancelled", message: "Sign-in cancelled." }
    }
    let poll: { readonly status: number; readonly body: unknown }
    try {
      poll = await fetchJson(
        fetchFn,
        `${apiUrl}/device/token`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_code: started.device_code }),
        },
        timeoutMs,
        options.signal,
      )
    } catch {
      const message = "Lost connection to Pendix while waiting for approval."
      write(`${message}\n`)
      return { ok: false, reason: "sign_in_failed", message }
    }

    if (poll.status === 200 && isRecord(poll.body)) {
      const deviceToken =
        typeof poll.body.device_token === "string"
          ? poll.body.device_token
          : typeof poll.body.access_token === "string"
            ? poll.body.access_token
            : undefined
      if (!deviceToken) {
        const message = "Pendix returned an invalid device token."
        write(`${message}\n`)
        return { ok: false, reason: "sign_in_failed", message }
      }
      const storedToken: StoredDeviceToken = {
        device_token: deviceToken,
        refresh_token: typeof poll.body.refresh_token === "string" ? poll.body.refresh_token : undefined,
        device_id: typeof poll.body.device_id === "string" ? poll.body.device_id : undefined,
        device_name: typeof poll.body.device_name === "string" ? poll.body.device_name : defaultDeviceName(),
        api_url: apiUrl,
      }
      options.storage.saveToken(storedToken)

      const meResult = await fetchMe({
        fetchFn,
        apiUrl,
        token: storedToken.device_token,
        now,
        timeoutMs,
        signal: options.signal,
      })
      if (meResult.kind !== "ok") {
        const message = "Signed in, but could not load your account details."
        write(`${message}\n`)
        return { ok: false, reason: "sign_in_failed", message }
      }
      options.storage.saveMeCache(meResult.account)
      write(`Signed in as ${meResult.account.display_name} (${meResult.account.plan} plan).\n`)
      return buildSignedInSuccess({
        account: meResult.account,
        offline: false,
        token: storedToken,
        apiUrl,
        storage: options.storage,
        fetchFn,
        now,
        timeoutMs,
      })
    }

    const errorCode = isRecord(poll.body) && typeof poll.body.error === "string" ? poll.body.error : undefined
    if (errorCode === "slow_down") {
      intervalSeconds += 5
    } else if (errorCode === "expired_token" || errorCode === "access_denied" || errorCode === "invalid_grant") {
      const message =
        errorCode === "expired_token"
          ? "The sign-in code expired. Run pendix again to get a new code."
          : "Sign-in was not approved."
      write(`${message}\n`)
      return { ok: false, reason: "sign_in_failed", message }
    }

    try {
      await sleep(intervalSeconds * 1000, options.signal)
    } catch {
      return { ok: false, reason: "cancelled", message: "Sign-in cancelled." }
    }
  }

  const message = "The sign-in code expired. Run pendix again to get a new code."
  write(`${message}\n`)
  return { ok: false, reason: "sign_in_failed", message }
}

export async function ensureSignedIn(options: PendixAuthOptions): Promise<EnsureSignedInResult> {
  const env = options.env ?? process.env
  const apiUrl = options.apiUrl ?? resolvePendixApiUrl(env)
  const now = options.now ?? (() => Date.now())
  const fetchFn = options.fetchFn ?? fetch
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS

  const token = options.storage.loadToken()
  if (!token) {
    return loginPendix(options)
  }

  const cached = options.storage.loadMeCache()
  const meResult = await fetchMe({
    fetchFn,
    apiUrl,
    token: token.device_token,
    now,
    timeoutMs,
    signal: options.signal,
  })

  if (meResult.kind === "ok") {
    options.storage.saveMeCache(meResult.account)
    return buildSignedInSuccess({
      account: meResult.account,
      offline: false,
      token,
      apiUrl,
      storage: options.storage,
      fetchFn,
      now,
      timeoutMs,
    })
  }

  if (meResult.kind === "unauthorized") {
    options.storage.clearToken()
    write("Your session is no longer valid. Sign in again.\n")
    return loginPendix(options)
  }

  if (meResult.kind === "unreachable") {
    if (cached && isMeCacheUsableOffline(cached, now())) {
      return buildSignedInSuccess({
        account: toOfflineAccount(cached),
        offline: true,
        token,
        apiUrl,
        storage: options.storage,
        fetchFn,
        now,
        timeoutMs,
      })
    }
    const reason = cached ? "offline_cache_expired" : "offline_no_cache"
    const message = cached
      ? "Cannot reach Pendix and your saved sign-in is older than 7 days. Connect to the internet to sign in again."
      : "Cannot reach Pendix right now. Your first sign-in needs an internet connection."
    write(`${message}\n`)
    return { ok: false, reason, message }
  }

  write(`${meResult.message}\n`)
  return { ok: false, reason: "sign_in_failed", message: meResult.message }
}

export async function logoutPendix(options: PendixAuthOptions): Promise<{ readonly hadToken: boolean }> {
  const env = options.env ?? process.env
  const apiUrl = options.apiUrl ?? resolvePendixApiUrl(env)
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS

  const token = options.storage.loadToken()
  if (!token) {
    options.storage.clearToken()
    return { hadToken: false }
  }

  if (token.device_id) {
    await fetchJson(
      fetchFn,
      `${apiUrl}/devices/${encodeURIComponent(token.device_id)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token.device_token}` },
      },
      timeoutMs,
      options.signal,
    ).catch(() => undefined)
  }

  options.storage.clearToken()
  return { hadToken: true }
}

export async function whoamiPendix(options: PendixAuthOptions): Promise<WhoamiResult> {
  const env = options.env ?? process.env
  const apiUrl = options.apiUrl ?? resolvePendixApiUrl(env)
  const now = options.now ?? (() => Date.now())
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS

  const token = options.storage.loadToken()
  if (!token) {
    return { signedIn: false, message: "Not signed in. Run pendix login to sign in." }
  }

  const cached = options.storage.loadMeCache()
  const meResult = await fetchMe({
    fetchFn,
    apiUrl,
    token: token.device_token,
    now,
    timeoutMs,
    signal: options.signal,
  })

  if (meResult.kind === "ok") {
    options.storage.saveMeCache(meResult.account)
    return { signedIn: true, offline: false, account: meResult.account }
  }

  if (meResult.kind === "unauthorized") {
    options.storage.clearToken()
    return { signedIn: false, message: "Not signed in. Your device token is no longer valid." }
  }

  if (cached && isMeCacheUsableOffline(cached, now())) {
    return { signedIn: true, offline: true, account: toOfflineAccount(cached) }
  }

  return { signedIn: false, message: "Cannot reach Pendix and no recent cached sign-in was found." }
}

function buildSignedInSuccess(input: {
  readonly account: CachedMe
  readonly offline: boolean
  readonly token: StoredDeviceToken
  readonly apiUrl: string
  readonly storage: AuthStorage
  readonly fetchFn: typeof fetch
  readonly now: () => number
  readonly timeoutMs: number
}): Extract<EnsureSignedInResult, { readonly ok: true }> {
  return {
    ok: true,
    offline: input.offline,
    account: input.account,
    token: input.token,
    startBackgroundRefresh(handlers) {
      let stopped = false
      const timer = setInterval(async () => {
        if (stopped) return
        const result = await fetchMe({
          fetchFn: input.fetchFn,
          apiUrl: input.apiUrl,
          token: input.token.device_token,
          now: input.now,
          timeoutMs: input.timeoutMs,
        })
        if (stopped) return
        if (result.kind === "ok") {
          input.storage.saveMeCache(result.account)
          handlers.onUpdate({ account: result.account, offline: false })
          return
        }
        if (result.kind === "unauthorized") {
          input.storage.clearToken()
          handlers.onUnauthorized()
          return
        }
        if (result.kind === "unreachable") {
          const cached = input.storage.loadMeCache()
          if (cached && isMeCacheUsableOffline(cached, input.now())) {
            handlers.onUpdate({ account: toOfflineAccount(cached), offline: true })
          }
        }
      }, ME_CACHE_FRESH_MS)
      timer.unref?.()
      return () => {
        stopped = true
        clearInterval(timer)
      }
    },
  }
}

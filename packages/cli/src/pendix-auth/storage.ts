import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { entitlementsFor, type PlanEntitlements, type PlanId } from "@pendix/shared/plans"
import type { TeachLock } from "@pendix/shared/types"

export const ME_CACHE_FRESH_MS = 10 * 60 * 1000
export const ME_CACHE_OFFLINE_MAX_MS = 7 * 24 * 60 * 60 * 1000

const KEYCHAIN_SERVICE = "pendix"
const KEYCHAIN_ACCOUNT = "device-token"

export interface StoredDeviceToken {
  readonly device_token: string
  readonly refresh_token?: string
  readonly device_id?: string
  readonly device_name?: string
  readonly api_url?: string
}

export interface CachedMe {
  readonly id: string
  readonly display_name: string
  readonly email?: string
  readonly account_kind: string
  readonly status: string
  readonly plan: PlanId
  readonly entitlements: PlanEntitlements
  readonly teach_lock: TeachLock
  readonly credits: number
  readonly cached_at: number
}

export interface KeychainBackend {
  available(): boolean
  get(): string | undefined
  set(secret: string): boolean
  delete(): boolean
}

export interface AuthStorage {
  readonly configDir: string
  readonly tokenFilePath: string
  readonly meCacheFilePath: string
  loadToken(): StoredDeviceToken | undefined
  saveToken(token: StoredDeviceToken): "keychain" | "file"
  clearToken(): void
  loadMeCache(): CachedMe | undefined
  saveMeCache(me: CachedMe): void
  clearMeCache(): void
}

export interface CreateAuthStorageOptions {
  readonly configDir: string
  readonly keychain?: KeychainBackend
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizePlan(value: unknown): PlanId {
  if (value === "solo" || value === "mentored") return value
  return "free"
}

function normalizeTeachLock(value: unknown): TeachLock {
  if (value === "self" || value === "class") return value
  return "none"
}

function normalizeEntitlements(value: unknown, plan: PlanId): PlanEntitlements {
  const fallback = entitlementsFor(plan)
  if (!isRecord(value)) return fallback
  return {
    agent: typeof value.agent === "boolean" ? value.agent : fallback.agent,
    modelList: typeof value.modelList === "boolean" ? value.modelList : fallback.modelList,
    ownKeys: typeof value.ownKeys === "boolean" ? value.ownKeys : fallback.ownKeys,
    freeModels: typeof value.freeModels === "boolean" ? value.freeModels : fallback.freeModels,
    teachMode: typeof value.teachMode === "boolean" ? value.teachMode : fallback.teachMode,
    grading: typeof value.grading === "boolean" ? value.grading : fallback.grading,
    notes: typeof value.notes === "boolean" ? value.notes : fallback.notes,
    assessments: typeof value.assessments === "boolean" ? value.assessments : fallback.assessments,
    humanMentor: typeof value.humanMentor === "boolean" ? value.humanMentor : fallback.humanMentor,
    fairUseGradedSessionsPerMonth:
      typeof value.fairUseGradedSessionsPerMonth === "number"
        ? value.fairUseGradedSessionsPerMonth
        : fallback.fairUseGradedSessionsPerMonth,
  }
}

export function parseMePayload(raw: unknown, cachedAt: number): CachedMe | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.id !== "string" || typeof raw.display_name !== "string") return undefined
  const plan = normalizePlan(raw.plan)
  return {
    id: raw.id,
    display_name: raw.display_name,
    email: typeof raw.email === "string" ? raw.email : undefined,
    account_kind: typeof raw.account_kind === "string" ? raw.account_kind : "adult",
    status: typeof raw.status === "string" ? raw.status : "active",
    plan,
    entitlements: normalizeEntitlements(raw.entitlements, plan),
    teach_lock: normalizeTeachLock(raw.teach_lock),
    credits: typeof raw.credits === "number" && Number.isFinite(raw.credits) ? raw.credits : 0,
    cached_at: typeof raw.cached_at === "number" && Number.isFinite(raw.cached_at) ? raw.cached_at : cachedAt,
  }
}

function parseStoredToken(raw: string): StoredDeviceToken | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.device_token !== "string" || !parsed.device_token) return undefined
    return {
      device_token: parsed.device_token,
      refresh_token: typeof parsed.refresh_token === "string" ? parsed.refresh_token : undefined,
      device_id: typeof parsed.device_id === "string" ? parsed.device_id : undefined,
      device_name: typeof parsed.device_name === "string" ? parsed.device_name : undefined,
      api_url: typeof parsed.api_url === "string" ? parsed.api_url : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Writes a secret file with owner-only permissions (0600 on POSIX).
 *
 * Windows equivalent: POSIX mode bits are ignored by NTFS. On Windows, the equivalent
 * protection is restricting the file's NTFS ACL to the current user only
 * (`icacls <path> /inheritance:r /grant:r "%USERNAME%:(R,W)"`), or protecting the
 * bytes with Windows DPAPI (`ProtectedData.Protect(..., DataProtectionScope.CurrentUser)`).
 */
function writePrivateFile(filePath: string, contents: string, platform: NodeJS.Platform): void {
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600 })
  if (platform !== "win32") {
    chmodSync(tempPath, 0o600)
  }
  renameSync(tempPath, filePath)
  if (platform !== "win32") {
    chmodSync(filePath, 0o600)
    return
  }
  const username = process.env.USERNAME
  if (username) {
    Bun.spawnSync(["icacls", filePath, "/inheritance:r", "/grant:r", `${username}:(R,W)`], {
      stdout: "ignore",
      stderr: "ignore",
    })
  }
}

export function createOsKeychainBackend(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): KeychainBackend {
  if (env.PENDIX_DISABLE_KEYCHAIN === "1" || env.PENDIX_DISABLE_KEYCHAIN === "true") {
    return {
      available: () => false,
      get: () => undefined,
      set: () => false,
      delete: () => false,
    }
  }

  if (platform === "darwin") {
    return {
      available: () => Bun.which("security") !== null,
      get() {
        const result = Bun.spawnSync(
          ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
          { stdout: "pipe", stderr: "ignore" },
        )
        if (result.exitCode !== 0) return undefined
        return result.stdout.toString("utf8").trim() || undefined
      },
      set(secret: string) {
        const result = Bun.spawnSync(
          ["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", secret],
          { stdout: "ignore", stderr: "ignore" },
        )
        return result.exitCode === 0
      },
      delete() {
        const result = Bun.spawnSync(
          ["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT],
          { stdout: "ignore", stderr: "ignore" },
        )
        return result.exitCode === 0
      },
    }
  }

  if (platform === "linux") {
    return {
      available: () => Boolean(env.DBUS_SESSION_BUS_ADDRESS) && Bun.which("secret-tool") !== null,
      get() {
        const result = Bun.spawnSync(
          ["secret-tool", "lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT],
          { stdout: "pipe", stderr: "ignore" },
        )
        if (result.exitCode !== 0) return undefined
        return result.stdout.toString("utf8").trim() || undefined
      },
      set(secret: string) {
        const result = Bun.spawnSync(
          ["secret-tool", "store", "--label=Pendix", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT],
          { stdin: Buffer.from(secret, "utf8"), stdout: "ignore", stderr: "ignore" },
        )
        return result.exitCode === 0
      },
      delete() {
        const result = Bun.spawnSync(
          ["secret-tool", "clear", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT],
          { stdout: "ignore", stderr: "ignore" },
        )
        return result.exitCode === 0
      },
    }
  }

  return {
    available: () => false,
    get: () => undefined,
    set: () => false,
    delete: () => false,
  }
}

export function createAuthStorage(options: CreateAuthStorageOptions): AuthStorage {
  const platform = options.platform ?? process.platform
  const keychain = options.keychain ?? createOsKeychainBackend(platform, options.env ?? process.env)
  const tokenFilePath = path.join(options.configDir, "auth.json")
  const meCacheFilePath = path.join(options.configDir, "me-cache.json")

  return {
    configDir: options.configDir,
    tokenFilePath,
    meCacheFilePath,

    loadToken() {
      if (keychain.available()) {
        const fromKeychain = keychain.get()
        if (fromKeychain) {
          const parsed = parseStoredToken(fromKeychain)
          if (parsed) return parsed
        }
      }
      if (!existsSync(tokenFilePath)) return undefined
      try {
        return parseStoredToken(readFileSync(tokenFilePath, "utf8"))
      } catch {
        return undefined
      }
    },

    saveToken(token) {
      const serialized = JSON.stringify(token)
      if (keychain.available() && keychain.set(serialized)) {
        if (existsSync(tokenFilePath)) rmSync(tokenFilePath, { force: true })
        return "keychain"
      }
      writePrivateFile(tokenFilePath, `${serialized}\n`, platform)
      return "file"
    },

    clearToken() {
      if (keychain.available()) keychain.delete()
      if (existsSync(tokenFilePath)) rmSync(tokenFilePath, { force: true })
      if (existsSync(meCacheFilePath)) rmSync(meCacheFilePath, { force: true })
    },

    loadMeCache() {
      if (!existsSync(meCacheFilePath)) return undefined
      try {
        const parsed: unknown = JSON.parse(readFileSync(meCacheFilePath, "utf8"))
        return parseMePayload(parsed, 0)
      } catch {
        return undefined
      }
    },

    saveMeCache(me) {
      writePrivateFile(meCacheFilePath, `${JSON.stringify(me, null, 2)}\n`, platform)
    },

    clearMeCache() {
      if (existsSync(meCacheFilePath)) rmSync(meCacheFilePath, { force: true })
    },
  }
}

export function toOfflineAccount(cached: CachedMe): CachedMe {
  return {
    ...cached,
    entitlements: entitlementsFor("free"),
  }
}

export function isMeCacheFresh(cached: CachedMe, nowMs: number): boolean {
  return nowMs - cached.cached_at < ME_CACHE_FRESH_MS
}

export function isMeCacheUsableOffline(cached: CachedMe, nowMs: number): boolean {
  return nowMs - cached.cached_at < ME_CACHE_OFFLINE_MAX_MS
}

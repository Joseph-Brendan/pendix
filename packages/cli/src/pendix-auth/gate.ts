import { createRecorderStateStore, drainUploadQueue } from "@pendix/recorder"
import { resolvePendixApiUrl } from "@pendix/shared/urls"
import type { TuiAccountSnapshot, TuiAccountSource } from "@pendix/tui"
import { Global } from "@pendix/util/global"
import { Effect } from "effect"
import { ensureSignedIn, type EnsureSignedInResult } from "./client"
import { checkNewGradedNotice } from "./graded-notice"
import { createAuthStorage, type CachedMe } from "./storage"

function toTuiSnapshot(account: CachedMe, offline: boolean): TuiAccountSnapshot {
  return {
    displayName: account.display_name,
    plan: account.plan,
    accountKind: account.account_kind,
    offline,
    teachLock: account.teach_lock,
    credits: account.credits,
  }
}

export interface ActivePendixSession {
  readonly account: CachedMe
  readonly offline: boolean
  readonly tuiAccount: TuiAccountSource
}

export const requirePendixSignedIn = Effect.fn("pendix.auth.gate")(function* () {
  const global = yield* Global.Service
  const storage = createAuthStorage({ configDir: global.config })
  const result: EnsureSignedInResult = yield* Effect.promise(() => ensureSignedIn({ storage }))
  if (!result.ok) {
    process.exitCode = 1
    return undefined
  }

  // Drain any queued session uploads from previous runs and clean up 30-day-old local files.
  if (!result.offline) {
    const apiUrl = resolvePendixApiUrl()
    const stateStore = createRecorderStateStore(global.data)
    void drainUploadQueue({
      dataDir: global.data,
      stateStore,
      apiUrl,
      authToken: result.token.device_token,
    }).catch(() => undefined)

    const gradedNotice = yield* Effect.promise(() =>
      checkNewGradedNotice({
        apiUrl,
        authToken: result.token.device_token,
        configDir: global.config,
      }),
    )
    if (gradedNotice) {
      process.stderr.write(`${gradedNotice}\n`)
    }
  }

  let current = toTuiSnapshot(result.account, result.offline)
  const listeners = new Set<(next: TuiAccountSnapshot | undefined) => void>()

  const stopRefresh = result.startBackgroundRefresh({
    onUpdate(next) {
      current = toTuiSnapshot(next.account, next.offline)
      listeners.forEach((listener) => listener(current))
    },
    onUnauthorized() {
      current = { ...current, offline: false }
      listeners.forEach((listener) => listener(undefined))
    },
  })

  yield* Effect.addFinalizer(() => Effect.sync(stopRefresh))

  const tuiAccount: TuiAccountSource = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    account: result.account,
    offline: result.offline,
    tuiAccount,
  } satisfies ActivePendixSession
})

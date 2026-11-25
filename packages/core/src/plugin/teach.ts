export * as PendixTeachPlugin from "./teach.js"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SystemPart } from "@pendix/ai/effect"
import { define } from "@pendix/plugin/effect/plugin"
import type { SessionHooks } from "@pendix/plugin/effect/session"
import TEACH_PROMPT_RAW from "@pendix/shared/prompts/teach.md" with { type: "text" }
import { TEACH_MODE_FILE_NAME, normalizeTeachLock, resolveTeachMode } from "@pendix/shared/teach"
import type { TeachLock } from "@pendix/shared/types"
import { Global } from "@pendix/util/global"
import { Effect } from "effect"

export const TEACH_PROMPT = TEACH_PROMPT_RAW.trim()

const ME_CACHE_FILE_NAME = "me-cache.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function teachModeFilePath(configDir: string): string {
  return path.join(configDir, TEACH_MODE_FILE_NAME)
}

export function readTeachModeEnabled(configDir: string): boolean {
  const filePath = teachModeFilePath(configDir)
  if (!existsSync(filePath)) return false
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    return isRecord(parsed) && parsed.enabled === true
  } catch {
    return false
  }
}

export function writeTeachModeEnabled(configDir: string, enabled: boolean): void {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(teachModeFilePath(configDir), `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8")
}

export function readCachedTeachLock(configDir: string): TeachLock {
  const filePath = path.join(configDir, ME_CACHE_FILE_NAME)
  if (!existsSync(filePath)) return "none"
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    if (!isRecord(parsed)) return "none"
    return normalizeTeachLock(parsed.teach_lock)
  } catch {
    return "none"
  }
}

export function isTeachModeActive(configDir: string): boolean {
  return resolveTeachMode({
    localEnabled: readTeachModeEnabled(configDir),
    teachLock: readCachedTeachLock(configDir),
  }).enabled
}

export const Plugin = define({
  id: "pendix.teach",
  effect: Effect.fn("PendixTeachPlugin")(function* (ctx) {
    const global = yield* Global.Service
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        if (!isTeachModeActive(global.config)) return
        if (event.system.some((part) => part.text === TEACH_PROMPT)) return
        event.system.push(SystemPart.make(TEACH_PROMPT))
      })
    yield* ctx.session.hook("context", hook)
  }),
})

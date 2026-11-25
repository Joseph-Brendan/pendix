import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  TEACH_MODE_FILE_NAME,
  resolveTeachMode,
  toggleTeachMode,
  type TeachModeToggleResult,
} from "@pendix/shared/teach"
import type { TeachLock } from "@pendix/shared/types"
import { createContext, createMemo, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
import { useTuiAccount } from "./account"

export type TuiTeachContext = Readonly<{
  enabled: Accessor<boolean>
  locked: Accessor<boolean>
  lock: Accessor<TeachLock>
  lockMessage: Accessor<string | undefined>
  toggle: () => TeachModeToggleResult
}>

function readStoredTeachEnabled(configDir: string | undefined): boolean {
  if (!configDir) return false
  const filePath = path.join(configDir, TEACH_MODE_FILE_NAME)
  if (!existsSync(filePath)) return false
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    return typeof parsed === "object" && parsed !== null && (parsed as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

function writeStoredTeachEnabled(configDir: string | undefined, enabled: boolean): void {
  if (!configDir) return
  try {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(path.join(configDir, TEACH_MODE_FILE_NAME), `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8")
  } catch {
    // Never crash the TUI if disk writes fail.
  }
}

const defaultTeachContext: TuiTeachContext = {
  enabled: () => false,
  locked: () => false,
  lock: () => "none",
  lockMessage: () => undefined,
  toggle: () => toggleTeachMode({ localEnabled: false, teachLock: "none" }),
}

const TeachContext = createContext<TuiTeachContext>(defaultTeachContext)

export function TuiTeachProvider(props: ParentProps<{ configDir?: string; initialEnabled?: boolean }>) {
  const account = useTuiAccount()
  const [localEnabled, setLocalEnabled] = createSignal<boolean>(
    props.initialEnabled ?? readStoredTeachEnabled(props.configDir),
  )

  const state = createMemo(() =>
    resolveTeachMode({
      localEnabled: localEnabled(),
      teachLock: account()?.teachLock,
    }),
  )

  const value: TuiTeachContext = {
    enabled: () => state().enabled,
    locked: () => state().locked,
    lock: () => state().lock,
    lockMessage: () => state().lockMessage,
    toggle() {
      const result = toggleTeachMode({
        localEnabled: localEnabled(),
        teachLock: account()?.teachLock,
      })
      if (result.changed) {
        setLocalEnabled(result.localEnabled)
        writeStoredTeachEnabled(props.configDir, result.localEnabled)
      }
      return result
    },
  }

  return <TeachContext.Provider value={value}>{props.children}</TeachContext.Provider>
}

export function useTuiTeach(): TuiTeachContext {
  return useContext(TeachContext)
}

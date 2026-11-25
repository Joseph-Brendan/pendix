import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  TEACH_CLASS_LOCK_MESSAGE,
  TEACH_SELF_LOCK_MESSAGE,
  extractTeachCheckQuestion,
  resolveTeachMode,
  toggleTeachMode,
} from "../src/teach.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const teachPromptPath = path.resolve(here, "../src/prompts/teach.md")

describe("teach mode prompt and rules", () => {
  it("matches the snapshot of teach.md and follows plain-English rules", () => {
    const content = readFileSync(teachPromptPath, "utf8")
    expect(content).not.toContain("\u2014")
    expect(content).not.toContain("\u2013")
    expect(content).toMatchSnapshot()
  })

  it("resolves and toggles teach mode when unlocked", () => {
    expect(resolveTeachMode({ localEnabled: false, teachLock: "none" })).toEqual({
      enabled: false,
      locked: false,
      lock: "none",
    })

    const turnedOn = toggleTeachMode({ localEnabled: false, teachLock: "none" })
    expect(turnedOn).toEqual({
      enabled: true,
      localEnabled: true,
      changed: true,
      locked: false,
      lock: "none",
    })

    const turnedOff = toggleTeachMode({ localEnabled: true, teachLock: "none" })
    expect(turnedOff).toEqual({
      enabled: false,
      localEnabled: false,
      changed: true,
      locked: false,
      lock: "none",
    })
  })

  it("forces teach mode on and blocks toggles when class-locked", () => {
    expect(TEACH_CLASS_LOCK_MESSAGE).toBe("Teach mode is locked by your instructor")
    expect(resolveTeachMode({ localEnabled: false, teachLock: "class" })).toEqual({
      enabled: true,
      locked: true,
      lock: "class",
      lockMessage: "Teach mode is locked by your instructor",
    })

    const result = toggleTeachMode({ localEnabled: false, teachLock: "class" })
    expect(result).toEqual({
      enabled: true,
      localEnabled: false,
      changed: false,
      locked: true,
      lock: "class",
      message: "Teach mode is locked by your instructor",
    })
  })

  it("forces teach mode on and blocks toggles when self-locked until lock clears", () => {
    expect(resolveTeachMode({ localEnabled: false, teachLock: "self" })).toEqual({
      enabled: true,
      locked: true,
      lock: "self",
      lockMessage: TEACH_SELF_LOCK_MESSAGE,
    })

    const blocked = toggleTeachMode({ localEnabled: false, teachLock: "self" })
    expect(blocked.enabled).toBe(true)
    expect(blocked.changed).toBe(false)
    expect(blocked.locked).toBe(true)
    expect(blocked.message).toBe(TEACH_SELF_LOCK_MESSAGE)

    const unlocked = toggleTeachMode({ localEnabled: true, teachLock: "none" })
    expect(unlocked.enabled).toBe(false)
    expect(unlocked.changed).toBe(true)
    expect(unlocked.locked).toBe(false)
  })

  it("extracts a teach check question while ignoring code blocks", () => {
    const reply = [
      "I updated `src/cart.ts` to keep totals in integer cents.",
      "```ts",
      "const fee = isMember ? 0 : 200",
      "```",
      "Quick check: Why do we store money as integer cents instead of floats?",
    ].join("\n")

    expect(extractTeachCheckQuestion(reply)).toBe("Why do we store money as integer cents instead of floats?")

    const codeOnlyQuestion = [
      "Updated the ternary check.",
      "```ts",
      "const status = ok ? 'yes' : 'no'",
      "```",
    ].join("\n")
    expect(extractTeachCheckQuestion(codeOnlyQuestion)).toBeUndefined()
  })
})

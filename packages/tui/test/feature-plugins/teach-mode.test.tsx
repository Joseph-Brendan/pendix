/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@pendix/plugin/tui/context"
import { BRAND_COLOURS } from "@pendix/shared/brand"
import { createSignal } from "solid-js"
import { TuiAccountProvider, type TuiAccountSnapshot } from "../../src/context/account"
import { TuiTeachProvider, useTuiTeach, type TuiTeachContext } from "../../src/context/teach"
import { AccountStatus } from "../../src/feature-plugins/home/footer"

const tempDirs: string[] = []

function makeTempConfigDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pendix-tui-teach-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function mockContext(): Context {
  return {
    theme: {
      text: {
        base: RGBA.fromInts(246, 245, 242),
        muted: RGBA.fromInts(107, 104, 98),
        feedback: {
          warning: { base: RGBA.fromHex(BRAND_COLOURS.hotOrange) },
        },
      },
      pendix: {
        logoDot: RGBA.fromHex(BRAND_COLOURS.hotOrange),
        scoreBadge: RGBA.fromHex(BRAND_COLOURS.hotOrange),
        teachModeTag: RGBA.fromHex(BRAND_COLOURS.hotOrange),
        mainActionHint: RGBA.fromHex(BRAND_COLOURS.hotOrange),
      },
    },
  } as unknown as Context
}

describe("teach mode TUI status and locks", () => {
  test("toggles Teach tag in hot orange when unlocked", async () => {
    const configDir = makeTempConfigDir()
    const source = {
      current: (): TuiAccountSnapshot => ({
        displayName: "Ada Learner",
        plan: "free",
        offline: false,
        teachLock: "none",
      }),
    }

    let teachApi: TuiTeachContext | undefined
    function Harness() {
      teachApi = useTuiTeach()
      return <AccountStatus context={mockContext()} />
    }

    const app = await testRender(
      () => (
        <TuiAccountProvider source={source}>
          <TuiTeachProvider configDir={configDir}>
            <Harness />
          </TuiTeachProvider>
        </TuiAccountProvider>
      ),
      { width: 80, height: 2 },
    )

    try {
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Teach")
      expect(teachApi!.enabled()).toBe(false)

      const onResult = teachApi!.toggle()
      expect(onResult.changed).toBe(true)
      expect(onResult.enabled).toBe(true)
      await app.renderOnce()

      const onFrame = app.captureCharFrame()
      expect(onFrame).toContain("Teach")
      expect(onFrame).toContain("Ada Learner")
      expect(onFrame).toContain("Free")

      // Verify the rendered Teach tag uses hot orange (#FF5A1F).
      const spans = app.captureSpans()
      const teachSpan = spans.lines
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes("Teach"))
      expect(teachSpan).toBeDefined()
      expect(teachSpan!.fg.toInts()).toEqual(RGBA.fromHex(BRAND_COLOURS.hotOrange).toInts())

      const offResult = teachApi!.toggle()
      expect(offResult.changed).toBe(true)
      expect(offResult.enabled).toBe(false)
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Teach")
    } finally {
      app.renderer.destroy()
    }
  })

  test("class lock forces Teach on, ignores toggles, and returns the instructor message", async () => {
    const configDir = makeTempConfigDir()
    const source = {
      current: (): TuiAccountSnapshot => ({
        displayName: "Ada Learner",
        plan: "solo",
        offline: false,
        teachLock: "class",
      }),
    }

    let teachApi: TuiTeachContext | undefined
    function Harness() {
      teachApi = useTuiTeach()
      return <AccountStatus context={mockContext()} />
    }

    const app = await testRender(
      () => (
        <TuiAccountProvider source={source}>
          <TuiTeachProvider configDir={configDir}>
            <Harness />
          </TuiTeachProvider>
        </TuiAccountProvider>
      ),
      { width: 80, height: 2 },
    )

    try {
      await app.renderOnce()
      expect(teachApi!.enabled()).toBe(true)
      expect(teachApi!.locked()).toBe(true)
      expect(teachApi!.lock()).toBe("class")
      expect(app.captureCharFrame()).toContain("Teach")

      const result = teachApi!.toggle()
      expect(result.changed).toBe(false)
      expect(result.enabled).toBe(true)
      expect(result.message).toBe("Teach mode is locked by your instructor")

      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Teach")
    } finally {
      app.renderer.destroy()
    }
  })

  test("self lock ignores toggles until /me teachLock changes back to none", async () => {
    const configDir = makeTempConfigDir()
    const [snapshot, setSnapshot] = createSignal<TuiAccountSnapshot>({
      displayName: "Ada Learner",
      plan: "free",
      offline: false,
      teachLock: "self",
    })
    const listeners = new Set<(next: TuiAccountSnapshot | undefined) => void>()
    const source = {
      current: () => snapshot(),
      subscribe: (listener: (next: TuiAccountSnapshot | undefined) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }

    let teachApi: TuiTeachContext | undefined
    function Harness() {
      teachApi = useTuiTeach()
      return <AccountStatus context={mockContext()} />
    }

    const app = await testRender(
      () => (
        <TuiAccountProvider source={source}>
          <TuiTeachProvider configDir={configDir}>
            <Harness />
          </TuiTeachProvider>
        </TuiAccountProvider>
      ),
      { width: 80, height: 2 },
    )

    try {
      await app.renderOnce()
      expect(teachApi!.enabled()).toBe(true)
      expect(teachApi!.locked()).toBe(true)
      expect(app.captureCharFrame()).toContain("Teach")

      const blocked = teachApi!.toggle()
      expect(blocked.changed).toBe(false)
      expect(blocked.enabled).toBe(true)
      expect(blocked.message).toContain("dashboard")

      // Simulate /me updating after learner unlocks teach mode from the dashboard.
      const unlockedSnapshot: TuiAccountSnapshot = {
        displayName: "Ada Learner",
        plan: "free",
        offline: false,
        teachLock: "none",
      }
      setSnapshot(unlockedSnapshot)
      listeners.forEach((fn) => fn(unlockedSnapshot))
      await app.renderOnce()

      expect(teachApi!.locked()).toBe(false)
      expect(teachApi!.enabled()).toBe(false)
      expect(app.captureCharFrame()).not.toContain("Teach")

      const turnedOn = teachApi!.toggle()
      expect(turnedOn.changed).toBe(true)
      expect(turnedOn.enabled).toBe(true)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Teach")
    } finally {
      app.renderer.destroy()
    }
  })
})

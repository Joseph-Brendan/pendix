/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@pendix/plugin/tui/context"
import { createSignal } from "solid-js"
import { TuiAccountProvider, type TuiAccountSnapshot } from "../../src/context/account"
import { AccountStatus } from "../../src/feature-plugins/home/footer"

function mockContext(): Context {
  return {
    theme: {
      text: {
        base: RGBA.fromInts(246, 245, 242),
        muted: RGBA.fromInts(107, 104, 98),
        feedback: {
          warning: { base: RGBA.fromInts(255, 90, 31) },
        },
      },
    },
  } as unknown as Context
}

describe("terminal status area account display", () => {
  test("shows display name and plan, and shows offline tag when offline", async () => {
    const [snapshot, setSnapshot] = createSignal<TuiAccountSnapshot | undefined>({
      displayName: "Ada Learner",
      plan: "solo",
      offline: false,
    })

    const listeners = new Set<(next: TuiAccountSnapshot | undefined) => void>()
    const source = {
      current: () => snapshot(),
      subscribe: (listener: (next: TuiAccountSnapshot | undefined) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }

    const app = await testRender(
      () => (
        <TuiAccountProvider source={source}>
          <AccountStatus context={mockContext()} />
        </TuiAccountProvider>
      ),
      { width: 80, height: 2 },
    )

    try {
      await app.renderOnce()
      const onlineFrame = app.captureCharFrame()
      expect(onlineFrame).toContain("Ada Learner")
      expect(onlineFrame).toContain("Solo")
      expect(onlineFrame.toLowerCase()).not.toContain("offline")

      const next: TuiAccountSnapshot = {
        displayName: "Ada Learner",
        plan: "solo",
        offline: true,
      }
      setSnapshot(next)
      listeners.forEach((fn) => fn(next))
      await app.renderOnce()

      const offlineFrame = app.captureCharFrame()
      expect(offlineFrame).toContain("Ada Learner")
      expect(offlineFrame).toContain("Solo")
      expect(offlineFrame.toLowerCase()).toContain("offline")
    } finally {
      app.renderer.destroy()
    }
  })
})

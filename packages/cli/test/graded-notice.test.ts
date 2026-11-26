import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkNewGradedNotice, formatGradedStatus } from "../src/pendix-auth/graded-notice"

const tempDirs: string[] = []

function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pendix-graded-notice-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("terminal graded report status and startup notice", () => {
  test("formats graded session status with score and emailed tag", () => {
    expect(formatGradedStatus(7.4, true)).toBe("Graded: 7.4/10 · report emailed")
    expect(formatGradedStatus(7.4, false)).toBe("Graded: 7.4/10")
    expect(formatGradedStatus(8, true)).toBe("Graded: 8.0/10 · report emailed")
  })

  test("shows a startup notice once per newly graded session", async () => {
    const configDir = makeTempDir()
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: "ses_graded_1",
              project_title: "pendix-shop",
              status: "graded",
              score: 7.4,
              report_emailed: true,
              created_at: "2026-11-26T12:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )

    const first = await checkNewGradedNotice({
      apiUrl: "http://127.0.0.1:3001",
      authToken: "tok_test",
      configDir,
      fetchImpl: fakeFetch,
    })
    expect(first).toBe("Graded: 7.4/10 · report emailed")

    // Second start for the same graded session does not repeat the notice.
    const second = await checkNewGradedNotice({
      apiUrl: "http://127.0.0.1:3001",
      authToken: "tok_test",
      configDir,
      fetchImpl: fakeFetch,
    })
    expect(second).toBeUndefined()
  })
})

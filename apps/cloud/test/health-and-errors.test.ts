import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { createLogger } from "../src/logger.js"

function captureLogs() {
  const stream = new PassThrough()
  const lines: Record<string, unknown>[] = []
  let buffer = ""
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      if (part.trim()) lines.push(JSON.parse(part) as Record<string, unknown>)
    }
  })
  return { logger: createLogger({ level: "info", destination: stream }), lines }
}

describe("health, error handling, and request IDs", () => {
  it("GET /health returns 200 with ok and version and logs a requestId", async () => {
    const { logger, lines } = captureLogs()
    const app = createApp({ version: "0.1.0", nodeEnv: "test", logger })

    const res = await app.request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: "0.1.0" })

    const requestId = res.headers.get("x-request-id")
    expect(requestId).toBeTruthy()
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.requestId).toBe(requestId)
    }
  })

  it("returns 404 in the standard error shape for unknown routes", async () => {
    const { logger } = captureLogs()
    const app = createApp({ version: "0.1.0", nodeEnv: "test", logger })

    const res = await app.request("/does-not-exist")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    })
  })

  it("returns 500 without a stack trace when NODE_ENV=production", async () => {
    const { logger, lines } = captureLogs()
    const app = createApp({ version: "0.1.0", nodeEnv: "production", logger })
    app.get("/boom", () => {
      throw new Error("secret internal database detail")
    })

    const res = await app.request("/boom")
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: Record<string, unknown> }
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    })
    expect(JSON.stringify(body)).not.toContain("secret internal database detail")
    expect(JSON.stringify(body)).not.toContain("stack")
    expect(body.error.stack).toBeUndefined()

    const requestId = res.headers.get("x-request-id")
    expect(requestId).toBeTruthy()
    expect(lines.some((line) => line.requestId === requestId)).toBe(true)
  })
})

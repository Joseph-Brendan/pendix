import { describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { createLogger } from "../src/logger.js"

describe("rate limiting", () => {
  it("returns 429 after the per-IP limit and resets after the window using a fake clock", async () => {
    let now = 1_700_000_000_000
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      rateLimit: {
        ipMax: 2,
        ipWindowMs: 60_000,
        userMax: 10,
        userWindowMs: 60_000,
        now: () => now,
      },
    })

    const headers = { "x-forwarded-for": "203.0.113.10" }
    expect((await app.request("/health", { headers })).status).toBe(200)
    expect((await app.request("/health", { headers })).status).toBe(200)

    const limited = await app.request("/health", { headers })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
      },
    })

    // Different IP is unaffected.
    expect((await app.request("/health", { headers: { "x-forwarded-for": "203.0.113.11" } })).status).toBe(200)

    // After the window advances, the original IP succeeds again.
    now += 60_001
    expect((await app.request("/health", { headers })).status).toBe(200)
  })

  it("enforces per-user rate limit independently of IP", async () => {
    const now = 1_700_000_000_000
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      resolveUserId: (c) => c.req.header("x-test-user-id"),
      rateLimit: {
        ipMax: 10,
        ipWindowMs: 60_000,
        userMax: 2,
        userWindowMs: 60_000,
        now: () => now,
      },
    })

    expect(
      (await app.request("/health", { headers: { "x-forwarded-for": "198.51.100.1", "x-test-user-id": "user-1" } }))
        .status,
    ).toBe(200)
    expect(
      (await app.request("/health", { headers: { "x-forwarded-for": "198.51.100.2", "x-test-user-id": "user-1" } }))
        .status,
    ).toBe(200)

    const limited = await app.request("/health", {
      headers: { "x-forwarded-for": "198.51.100.3", "x-test-user-id": "user-1" },
    })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
      },
    })
  })
})

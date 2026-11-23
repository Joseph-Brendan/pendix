import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Otlp } from "../src/observability/otlp.js"

test("does not export spans or logs when OTLP telemetry is disabled in Pendix", async () => {
  const requests: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.text())
      return Response.json({})
    },
  })

  try {
    const app = { client: "test", version: "1.0.0", channel: "local" }
    expect(Otlp.loggers({ endpoint: server.url.origin }, app)).toEqual([])
    expect(Otlp.resource(app).serviceName).toBe("pendix")

    await Effect.gen(function* () {
      const tracing = yield* Otlp.tracingLayer({ endpoint: server.url.origin, headers: "x-otel-test=present" }, app)
      yield* Effect.void.pipe(Effect.withSpan("otlp-smoke"), Effect.provide(tracing))
    }).pipe(Effect.scoped, Effect.runPromise)

    expect(requests).toHaveLength(0)
  } finally {
    server.stop(true)
  }
})

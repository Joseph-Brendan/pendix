import { expect } from "bun:test"
import { UsageLimits } from "@pendix/core/usage-limits"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

it.effect("returns undefined without contacting OpenCode Console", () =>
  Effect.gen(function* () {
    const limits = yield* Effect.flatMap(UsageLimits.Service, (service) => service.get()).pipe(
      Effect.provide(UsageLimits.layer),
    )
    expect(limits).toBeUndefined()
  }),
)

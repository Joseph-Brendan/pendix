export * as UsageLimits from "./usage-limits.js"

import { UsageLimits } from "@pendix/schema/usage-limits"
import { makeLocationNode } from "@pendix/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"

export const Info = UsageLimits.Info
export type Info = UsageLimits.Info

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("UsageLimits.UnavailableError", {
  message: Schema.String,
}) {}

export interface Interface {
  /** Workspace usage limits, if any. Disabled in Pendix (no OpenCode Console connection). */
  readonly get: () => Effect.Effect<Info | undefined, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageLimits") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed(undefined),
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})

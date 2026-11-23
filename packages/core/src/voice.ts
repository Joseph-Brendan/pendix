export * as Voice from "./voice.js"

import { type AIError } from "@pendix/ai/effect"
import {
  Realtime,
  type RealtimeEngine,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
  type RealtimeTransportType,
} from "@pendix/ai/experimental"
import { RequestExecutor } from "@pendix/ai/route"
import { makeLocationNode } from "@pendix/util/effect/app-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { Credential } from "./credential.js"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { ModelsDev } from "./models-dev.js"

export interface ModelInfo {
  readonly model: string
  readonly name: string
  readonly engine: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
}

export interface Models {
  readonly models: readonly ModelInfo[]
  readonly default?: string
}

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Voice.InvalidRequestError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = InvalidRequestError | UnavailableError

export interface Interface {
  readonly models: () => Effect.Effect<Models>
  readonly session: (input: SessionInput) => Effect.Effect<RealtimeTransport, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service
    const modelsDev = yield* ModelsDev.Service

    // Integration lists the active credential first, then newer stored credentials, then non-empty env vars.
    const findConnection = (provider: string, methods: readonly string[] = ["key"]) =>
      integrations
        .get(Integration.ID.make(provider))
        .pipe(
          Effect.map((info) => info?.connections.find((item) => item.type === "env" || methods.includes(item.method))),
        )

    // Where an engine's sessions start: its provider with the server's own API key.
    const source = Effect.fnUntraced(function* (engine: RealtimeEngine) {
      const connection = yield* findConnection(engine.provider)
      if (connection) return { provider: engine.provider, connection }
      return undefined
    })

    // Each engine's models.dev voice models from the provider that would start them, newest first.
    const offered = Effect.fnUntraced(function* () {
      const catalog = yield* modelsDev.get()
      const lists = yield* Effect.forEach(Realtime.engines, (engine) =>
        source(engine).pipe(
          Effect.map((found) => {
            const provider = found?.provider ?? engine.provider
            return (catalog.find((item) => item.info.id === provider)?.voices ?? [])
              .filter((voice) => voice.api === engine.api)
              .toSorted((a, b) => b.releaseDate.localeCompare(a.releaseDate))
              .map((voice) => ({
                engine,
                found,
                info: {
                  model: voice.id,
                  name: voice.name,
                  engine: engine.id,
                  provider,
                  transports: engine.transports,
                  available: found !== undefined,
                },
              }))
          }),
        ),
      )
      return lists.flat()
    })

    const models = Effect.fn("Voice.models")(function* () {
      const list = (yield* offered()).map((item) => item.info)
      const first = list.find((item) => item.available)?.model
      return first ? { models: list, default: first } : { models: list }
    })

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const list = yield* offered()
      const offer = list.find((item) => item.info.model === input.model)
      if (!offer)
        return yield* new InvalidRequestError({
          message: `Unsupported voice model: ${input.model}. This server lists ${list.map((item) => item.info.model).join(", ") || "none"}.`,
        })

      const engine = offer.engine
      const found = offer.found
      const credential = found
        ? yield* integrations.connection
            .resolve(found.connection)
            .pipe(Effect.mapError((error) => new UnavailableError({ service: found.provider, message: error.message })))
        : undefined
      const access = found && credential && sessionAccess(found.provider, credential)
      if (found === undefined || access === undefined)
        return yield* new UnavailableError({
          service: engine.provider,
          message: engine.id === "openai-live" ? missingLiveKeyMessage : missingKeyMessage[engine.provider],
        })

      return yield* Realtime.connect({
        engine,
        model: input.model,
        session: input.session,
        transport: input.transport,
        ...access,
      }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: found.provider }),
        ),
      )
    })

    return Service.of({ models, session })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, ModelsDev.node, requestExecutor],
})

/** What a credential starts a session with: a provider's API key on its own API. */
const sessionAccess = (_provider: string, credential: Credential.Value) => {
  return credential.type === "key" ? { apiKey: Redacted.make(credential.key) } : undefined
}

const missingLiveKeyMessage =
  "GPT-Live needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions."

const missingKeyMessage = {
  openai:
    "Voice needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions.",
  xai: "Voice needs an xAI API key on the server (a stored key or XAI_API_KEY).",
  google:
    "Voice needs a Google API key on the server (a stored key, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY).",
} as const

export * as Provider from "./provider.js"

import { Context, Effect, Layer, Option, Schema, Stream, Struct } from "effect"
import { Provider } from "@pendix/schema/provider"
import { Model } from "@pendix/schema/model"
import { makeLocationNode } from "@pendix/util/effect/app-node"
import { HttpTimeout, type ProviderPackage } from "@pendix/ai/effect"
import { Npm } from "@pendix/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@pendix/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@pendix/schema/credential"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export { AISDK_PREFIX, aisdk, isAISDK, mergeHeaders, mergeOverlay, packageName } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@pendix/ai/providers/alibaba", () => import("@pendix/ai/providers/alibaba")],
  ["@pendix/ai/providers/alibaba/chat", () => import("@pendix/ai/providers/alibaba/chat")],
  ["@pendix/ai/providers/alibaba/messages", () => import("@pendix/ai/providers/alibaba/messages")],
  ["@pendix/ai/providers/alibaba/responses", () => import("@pendix/ai/providers/alibaba/responses")],
  ["@pendix/ai/providers/alibaba/images", () => import("@pendix/ai/providers/alibaba/images")],
  ["@pendix/ai/providers/alibaba/embeddings", () => import("@pendix/ai/providers/alibaba/embeddings")],
  ["@pendix/ai/providers/amazon-bedrock", () => import("@pendix/ai/providers/amazon-bedrock")],
  ["@pendix/ai/providers/amazon-bedrock/mantle", () => import("@pendix/ai/providers/amazon-bedrock/mantle")],
  [
    "@pendix/ai/providers/amazon-bedrock/mantle/chat",
    () => import("@pendix/ai/providers/amazon-bedrock/mantle/chat"),
  ],
  [
    "@pendix/ai/providers/amazon-bedrock/mantle/messages",
    () => import("@pendix/ai/providers/amazon-bedrock/mantle/messages"),
  ],
  [
    "@pendix/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@pendix/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@pendix/ai/providers/anthropic", () => import("@pendix/ai/providers/anthropic")],
  ["@pendix/ai/providers/anthropic-compatible", () => import("@pendix/ai/providers/anthropic-compatible")],
  ["@pendix/ai/providers/azure", () => import("@pendix/ai/providers/azure")],
  ["@pendix/ai/providers/azure/chat", () => import("@pendix/ai/providers/azure/chat")],
  ["@pendix/ai/providers/azure/responses", () => import("@pendix/ai/providers/azure/responses")],
  ["@pendix/ai/providers/azure/images", () => import("@pendix/ai/providers/azure/images")],
  ["@pendix/ai/providers/azure/embeddings", () => import("@pendix/ai/providers/azure/embeddings")],
  ["@pendix/ai/providers/azure/messages", () => import("@pendix/ai/providers/azure/messages")],
  ["@pendix/ai/providers/baseten", () => import("@pendix/ai/providers/baseten")],
  ["@pendix/ai/providers/baseten/decisions", () => import("@pendix/ai/providers/baseten/decisions")],
  ["@pendix/ai/providers/byteplus/videos", () => import("@pendix/ai/providers/byteplus/videos")],
  ["@pendix/ai/providers/cerebras", () => import("@pendix/ai/providers/cerebras")],
  ["@pendix/ai/providers/cloudflare-ai-gateway", () => import("@pendix/ai/providers/cloudflare-ai-gateway")],
  [
    "@pendix/ai/providers/cloudflare-ai-gateway/decisions",
    () => import("@pendix/ai/providers/cloudflare-ai-gateway/decisions"),
  ],
  ["@pendix/ai/providers/cloudflare-workers-ai", () => import("@pendix/ai/providers/cloudflare-workers-ai")],
  [
    "@pendix/ai/providers/cloudflare-workers-ai/decisions",
    () => import("@pendix/ai/providers/cloudflare-workers-ai/decisions"),
  ],
  [
    "@pendix/ai/providers/cloudflare-workers-ai/images",
    () => import("@pendix/ai/providers/cloudflare-workers-ai/images"),
  ],
  ["@pendix/ai/providers/cohere", () => import("@pendix/ai/providers/cohere")],
  ["@pendix/ai/providers/cohere/chat", () => import("@pendix/ai/providers/cohere/chat")],
  ["@pendix/ai/providers/cohere/embeddings", () => import("@pendix/ai/providers/cohere/embeddings")],
  ["@pendix/ai/providers/deepinfra", () => import("@pendix/ai/providers/deepinfra")],
  ["@pendix/ai/providers/deepinfra/embeddings", () => import("@pendix/ai/providers/deepinfra/embeddings")],
  ["@pendix/ai/providers/deepseek", () => import("@pendix/ai/providers/deepseek")],
  ["@pendix/ai/providers/digitalocean", () => import("@pendix/ai/providers/digitalocean")],
  ["@pendix/ai/providers/digitalocean/decisions", () => import("@pendix/ai/providers/digitalocean/decisions")],
  ["@pendix/ai/providers/digitalocean/embeddings", () => import("@pendix/ai/providers/digitalocean/embeddings")],
  ["@pendix/ai/providers/digitalocean/images", () => import("@pendix/ai/providers/digitalocean/images")],
  ["@pendix/ai/providers/digitalocean/responses", () => import("@pendix/ai/providers/digitalocean/responses")],
  ["@pendix/ai/providers/fireworks", () => import("@pendix/ai/providers/fireworks")],
  ["@pendix/ai/providers/fireworks/embeddings", () => import("@pendix/ai/providers/fireworks/embeddings")],
  ["@pendix/ai/providers/google", () => import("@pendix/ai/providers/google")],
  ["@pendix/ai/providers/google/decisions", () => import("@pendix/ai/providers/google/decisions")],
  ["@pendix/ai/providers/google/interactions", () => import("@pendix/ai/providers/google/interactions")],
  ["@pendix/ai/providers/google/embeddings", () => import("@pendix/ai/providers/google/embeddings")],
  ["@pendix/ai/providers/google/images", () => import("@pendix/ai/providers/google/images")],
  ["@pendix/ai/providers/google/videos", () => import("@pendix/ai/providers/google/videos")],
  ["@pendix/ai/providers/google-vertex", () => import("@pendix/ai/providers/google-vertex")],
  ["@pendix/ai/providers/google-vertex/chat", () => import("@pendix/ai/providers/google-vertex/chat")],
  ["@pendix/ai/providers/google-vertex/gemini", () => import("@pendix/ai/providers/google-vertex/gemini")],
  [
    "@pendix/ai/providers/google-vertex/interactions",
    () => import("@pendix/ai/providers/google-vertex/interactions"),
  ],
  ["@pendix/ai/providers/google-vertex/messages", () => import("@pendix/ai/providers/google-vertex/messages")],
  ["@pendix/ai/providers/google-vertex/mistral", () => import("@pendix/ai/providers/google-vertex/mistral")],
  ["@pendix/ai/providers/google-vertex/responses", () => import("@pendix/ai/providers/google-vertex/responses")],
  ["@pendix/ai/providers/google-vertex/embeddings", () => import("@pendix/ai/providers/google-vertex/embeddings")],
  ["@pendix/ai/providers/google-vertex/images", () => import("@pendix/ai/providers/google-vertex/images")],
  ["@pendix/ai/providers/google-vertex-messages", () => import("@pendix/ai/providers/google-vertex-messages")],
  ["@pendix/ai/providers/groq", () => import("@pendix/ai/providers/groq")],
  ["@pendix/ai/providers/meta", () => import("@pendix/ai/providers/meta")],
  ["@pendix/ai/providers/meta/chat", () => import("@pendix/ai/providers/meta/chat")],
  ["@pendix/ai/providers/meta/images", () => import("@pendix/ai/providers/meta/images")],
  ["@pendix/ai/providers/meta/messages", () => import("@pendix/ai/providers/meta/messages")],
  ["@pendix/ai/providers/meta/responses", () => import("@pendix/ai/providers/meta/responses")],
  ["@pendix/ai/providers/minimax", () => import("@pendix/ai/providers/minimax")],
  ["@pendix/ai/providers/minimax/chat", () => import("@pendix/ai/providers/minimax/chat")],
  ["@pendix/ai/providers/minimax/images", () => import("@pendix/ai/providers/minimax/images")],
  ["@pendix/ai/providers/minimax/messages", () => import("@pendix/ai/providers/minimax/messages")],
  ["@pendix/ai/providers/minimax/responses", () => import("@pendix/ai/providers/minimax/responses")],
  ["@pendix/ai/providers/minimax/videos", () => import("@pendix/ai/providers/minimax/videos")],
  ["@pendix/ai/providers/mistral", () => import("@pendix/ai/providers/mistral")],
  ["@pendix/ai/providers/moonshot", () => import("@pendix/ai/providers/moonshot")],
  ["@pendix/ai/providers/moonshot/chat", () => import("@pendix/ai/providers/moonshot/chat")],
  ["@pendix/ai/providers/moonshot/messages", () => import("@pendix/ai/providers/moonshot/messages")],
  ["@pendix/ai/providers/moonshot/responses", () => import("@pendix/ai/providers/moonshot/responses")],
  ["@pendix/ai/providers/openai", () => import("@pendix/ai/providers/openai")],
  ["@pendix/ai/providers/openai/chat", () => import("@pendix/ai/providers/openai/chat")],
  ["@pendix/ai/providers/openai/responses", () => import("@pendix/ai/providers/openai/responses")],
  ["@pendix/ai/providers/openai/images", () => import("@pendix/ai/providers/openai/images")],
  ["@pendix/ai/providers/openai/embeddings", () => import("@pendix/ai/providers/openai/embeddings")],
  ["@pendix/ai/providers/openai-compatible", () => import("@pendix/ai/providers/openai-compatible")],
  [
    "@pendix/ai/providers/openai-compatible/responses",
    () => import("@pendix/ai/providers/openai-compatible/responses"),
  ],
  ["@pendix/ai/providers/openai-compatible/images", () => import("@pendix/ai/providers/openai-compatible/images")],
  [
    "@pendix/ai/providers/openai-compatible/decisions",
    () => import("@pendix/ai/providers/openai-compatible/decisions"),
  ],
  [
    "@pendix/ai/providers/openai-compatible/embeddings",
    () => import("@pendix/ai/providers/openai-compatible/embeddings"),
  ],
  [
    "@pendix/ai/providers/openai-compatible-responses",
    () => import("@pendix/ai/providers/openai-compatible-responses"),
  ],
  ["@pendix/ai/providers/opencode/decisions", () => import("@pendix/ai/providers/opencode/decisions")],
  ["@pendix/ai/providers/openrouter", () => import("@pendix/ai/providers/openrouter")],
  ["@pendix/ai/providers/openrouter/decisions", () => import("@pendix/ai/providers/openrouter/decisions")],
  ["@pendix/ai/providers/openrouter/embeddings", () => import("@pendix/ai/providers/openrouter/embeddings")],
  ["@pendix/ai/providers/openrouter/images", () => import("@pendix/ai/providers/openrouter/images")],
  ["@pendix/ai/providers/openrouter/videos", () => import("@pendix/ai/providers/openrouter/videos")],
  ["@pendix/ai/providers/openrouter/responses", () => import("@pendix/ai/providers/openrouter/responses")],
  ["@pendix/ai/providers/togetherai", () => import("@pendix/ai/providers/togetherai")],
  ["@pendix/ai/providers/typesafe-ai/decisions", () => import("@pendix/ai/providers/typesafe-ai/decisions")],
  ["@pendix/ai/providers/venice", () => import("@pendix/ai/providers/venice")],
  ["@pendix/ai/providers/venice/responses", () => import("@pendix/ai/providers/venice/responses")],
  ["@pendix/ai/providers/volcengine/videos", () => import("@pendix/ai/providers/volcengine/videos")],
  ["@pendix/ai/providers/vercel-ai-gateway", () => import("@pendix/ai/providers/vercel-ai-gateway")],
  ["@pendix/ai/providers/vercel-ai-gateway/chat", () => import("@pendix/ai/providers/vercel-ai-gateway/chat")],
  [
    "@pendix/ai/providers/vercel-ai-gateway/messages",
    () => import("@pendix/ai/providers/vercel-ai-gateway/messages"),
  ],
  [
    "@pendix/ai/providers/vercel-ai-gateway/responses",
    () => import("@pendix/ai/providers/vercel-ai-gateway/responses"),
  ],
  [
    "@pendix/ai/providers/vercel-ai-gateway/decisions",
    () => import("@pendix/ai/providers/vercel-ai-gateway/decisions"),
  ],
  ["@pendix/ai/providers/vercel-ai-gateway/images", () => import("@pendix/ai/providers/vercel-ai-gateway/images")],
  [
    "@pendix/ai/providers/vercel-ai-gateway/embeddings",
    () => import("@pendix/ai/providers/vercel-ai-gateway/embeddings"),
  ],
  ["@pendix/ai/providers/xai", () => import("@pendix/ai/providers/xai")],
  ["@pendix/ai/providers/xai/images", () => import("@pendix/ai/providers/xai/images")],
  ["@pendix/ai/providers/xai/videos", () => import("@pendix/ai/providers/xai/videos")],
  ["@pendix/ai/providers/zai", () => import("@pendix/ai/providers/zai")],
  ["@pendix/ai/providers/zai/chat", () => import("@pendix/ai/providers/zai/chat")],
  ["@pendix/ai/providers/zai/images", () => import("@pendix/ai/providers/zai/images")],
  ["@pendix/ai/providers/zai-coding-plan", () => import("@pendix/ai/providers/zai-coding-plan")],
  ["@pendix/ai/providers/zai-coding-plan/chat", () => import("@pendix/ai/providers/zai-coding-plan/chat")],
  ["@pendix/ai/providers/zai-coding-plan/messages", () => import("@pendix/ai/providers/zai-coding-plan/messages")],
  [
    "@pendix/ai/providers/zai-coding-plan/responses",
    () => import("@pendix/ai/providers/zai-coding-plan/responses"),
  ],
])

/** Native `@pendix/ai/providers/*` entrypoints bundled with Core and loadable by name from config. */
export const builtinPackages: ReadonlySet<string> = new Set(builtins.keys())

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = AISDKNative.packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@pendix/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

const settingsKeys = Struct.keys(Provider.Settings.schema.fields)
const providerOnlyKeys = settingsKeys.filter((key) => !(key in Model.Settings.schema.fields))

/** The provider options: every settings key OpenCode doesn't read itself. */
export function nativeSettings(settings: Settings) {
  return Struct.omit(settings, settingsKeys)
}

/** Settings a model inherits from its provider. */
export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, providerOnlyKeys)
}

const decodeTimeout = Schema.decodeUnknownOption(HttpTimeout)

/** Applied to `headerTimeout` when provider settings leave it unset or invalid. */
export const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Applied to `chunkTimeout` when provider settings leave it unset or invalid. Some providers, such as DeepSeek, have
 * specifically asked clients to allow at least 15 minutes, because their models can stream nothing for minutes while
 * they reason.
 */
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000

/** One timeout setting without a default; invalid values are dropped. */
export function timeout(value: unknown) {
  return Option.getOrUndefined(decodeTimeout(value))
}

/** Request timeouts from provider settings, resolved for every route. `timeout` has no default. */
export function timeouts(settings: Readonly<Record<string, unknown>>) {
  return {
    timeout: timeout(settings.timeout),
    headerTimeout: timeout(settings.headerTimeout) ?? DEFAULT_TIMEOUT_MS,
    chunkTimeout: timeout(settings.chunkTimeout) ?? DEFAULT_CHUNK_TIMEOUT_MS,
  }
}

const decodeEncoding = Schema.decodeUnknownOption(Provider.Encoding)

/** Request body encoding from provider or model settings; invalid values are dropped. */
export function encoding(settings: Readonly<Record<string, unknown>>) {
  return Option.getOrUndefined(decodeEncoding(settings.encoding))
}

const decodeTls = Schema.decodeUnknownOption(Provider.Tls)

/** Client certificate from provider settings. An empty `cert` or `key`, such as a missing `{file:}`, leaves it unset. */
export function tls(settings: Readonly<Record<string, unknown>>) {
  const value = Option.getOrUndefined(decodeTls(settings.tls))
  return value?.cert && value.key ? value : undefined
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Cache = Provider.Cache
export type Cache = Provider.Cache

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@pendix/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export interface Editor {
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: () => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Provider") {}

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const state = State.create<
      Map<
        ID,
        {
          provider: MutableInfo
          models: ReadonlyMap<Model.ID, Model.Info>
          sourceConnection?: IntegrationConnection.Info
        }
      >,
      Editor
    >({
      name: "provider",
      initial: () => new Map(),
      editor: (records) => {
        const maps = new WeakSet<ReadonlyMap<Model.ID, Model.Info>>()
        const models = new WeakSet<Model.Info>()
        const entry = (id: ID) => {
          const current = records.get(id)
          if (current) return current
          const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
          records.set(id, added)
          maps.add(added.models)
          return added
        }
        const writable = (id: ID) => {
          const record = entry(id)
          if (maps.has(record.models)) return record.models as Map<Model.ID, Model.Info>
          const owned = new Map(record.models)
          record.models = owned
          maps.add(owned)
          return owned
        }
        return {
          list: () => Array.from(records.values()),
          get: (id) => records.get(id),
          add: (definition) => {
            records.set(definition.info.id, {
              provider: structuredClone(definition.info) as MutableInfo,
              models: index(definition.info.id, definition.models),
              sourceConnection: definition.sourceConnection,
            })
          },
          update: (id, update) => {
            const record = entry(id)
            update(record.provider)
            record.provider.id = id
            AISDKNative.rewrite(record.provider, {
              builtins: builtinPackages,
              specifier: record.provider.package,
              providerID: id,
              canonical: record.provider.canonical,
            })
          },
          remove: (id) => {
            records.delete(id)
          },
          models: {
            set: (id, values) => {
              entry(id).models = index(id, values)
            },
            update: (providerID, modelID, update) => {
              const record = entry(providerID)
              const target = writable(providerID)
              const current = target.get(modelID)
              const model = // An earlier add/set can publish and freeze an owned model within this fold.
                (
                  current && models.has(current) && !Object.isFrozen(current)
                    ? current
                    : current
                      ? structuredClone(current)
                      : Model.Info.default(providerID, modelID)
                ) as DeepMutable<Model.Info>
              update(model)
              model.id = modelID
              model.providerID = providerID
              AISDKNative.rewrite(model, {
                builtins: builtinPackages,
                specifier: model.package ?? record.provider.package,
                providerID,
                canonical: model.canonical ?? record.provider.canonical,
                modelID: model.modelID ?? modelID,
              })
              models.add(model)
              target.set(modelID, model)
            },
            remove: (providerID, modelID) => {
              if (!records.has(providerID)) return
              writable(providerID).delete(modelID)
            },
          },
        }
      },
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached: { records: Snapshot["records"]; value: Snapshot } | undefined
    const snapshot = Effect.fn("Provider.snapshot")(function* () {
      while (true) {
        const revision = integrations.revision()
        const records = state.get()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || records !== state.get()) continue
        const byID = new Map(connections.map((integration) => [integration.id, integration]))
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integration = byID.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id))
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !==
              IntegrationConnection.key(integration?.connections[0])
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        if (
          cached?.records === records &&
          cached.value.available.length === available.length &&
          cached.value.available.every((record, index) => record === available[index])
        )
          return cached.value
        const value = freeze({ records, available, providers: available.map((record) => record.provider) }, true)
        cached = { records, value }
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Provider.get")((id) => Effect.sync(() => freeze(state.get().get(id)?.provider, true))),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().values(), (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackage.Definition
})

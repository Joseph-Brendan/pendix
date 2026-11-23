import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil } from "@pendix/util/fs-util"
import { Global } from "@pendix/util/global"
import { LayerNode } from "@pendix/util/effect/layer-node"
import { App } from "../src/app.js"
import { Bus } from "../src/bus.js"
import { ConfigDiscovery } from "../src/config/discovery.js"
import { Database } from "../src/database/database.js"
import { KV } from "../src/kv.js"
import { ModelsDev } from "../src/models-dev.js"
import { ProviderPlugins } from "../src/plugin/provider.js"
import { PluginInternal } from "../src/plugin/internal.js"

const OPENCODE_DOMAIN = /(?:^|\.)(?:opencode\.ai|opncd\.ai)$/i

function isOpenCodeHost(url: string) {
  try {
    return OPENCODE_DOMAIN.test(new URL(url).hostname)
  } catch {
    return /opencode\.ai|opncd\.ai/i.test(url)
  }
}

describe("Pendix core rebrand and zero OpenCode network calls", () => {
  test("project config uses pendix.json and system directories use pendix", () => {
    expect(ConfigDiscovery.names).toContain("pendix.json")
    expect(ConfigDiscovery.names).not.toContain("opencode.json")
    expect(String(ConfigDiscovery.systemDirectory("darwin"))).toBe("/Library/Application Support/pendix")
    expect(String(ConfigDiscovery.systemDirectory("linux"))).toBe("/etc/pendix")
  })

  test("OpenCode Console/Zen/Go provider plugin is not registered", () => {
    expect(ProviderPlugins.some((plugin) => plugin.id === "opencode.provider.opencode")).toBe(false)
    expect(PluginInternal.guarded.has("opencode.provider.opencode")).toBe(false)
  })

  test("with networking stubbed, ModelsDev refresh makes no request to any OpenCode domain", async () => {
    const requestedUrls: string[] = []
    const stubHttp = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        requestedUrls.push(request.url)
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
          ),
        )
      }),
    )

    const baseLayer = LayerNode.compile(
      LayerNode.group([Global.node, FSUtil.node, Database.node, KV.node, Bus.node, App.node]),
    ).pipe(Layer.provide(NodeFileSystem.layer))

    const modelsLayer = ModelsDev.layer({ fetch: true, snapshot: true }).pipe(
      Layer.provide(baseLayer),
      Layer.provide(stubHttp),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelsDev.Service
        yield* models.refresh(true)
      }).pipe(Effect.provide(modelsLayer), Effect.scoped),
    )

    expect(requestedUrls.length).toBeGreaterThan(0)
    expect(requestedUrls.filter(isOpenCodeHost)).toEqual([])
  })
})

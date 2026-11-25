import { describe, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AnthropicMessages, OpenAIChat } from "@pendix/ai/protocols"
import { SystemPart } from "@pendix/ai/effect"
import { Agent } from "@pendix/schema/agent"
import { Money } from "@pendix/schema/money"
import { Session } from "@pendix/schema/session"
import { Location } from "@pendix/core/location"
import { Plugin } from "@pendix/core/plugin"
import { PluginHost } from "@pendix/core/plugin/host"
import { Project } from "@pendix/core/project"
import { AbsolutePath } from "@pendix/core/schema"
import { SessionModelRequest } from "@pendix/core/session/model-request"
import { SessionModelTransport } from "@pendix/core/session/model-transport"
import { SessionRunnerModel } from "@pendix/core/session/runner/model"
import { Global } from "@pendix/util/global"
import { DateTime, Effect } from "effect"
import { PendixTeachPlugin } from "../../src/plugin/teach.js"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const here = path.dirname(fileURLToPath(import.meta.url))
const teachPromptText = readFileSync(path.resolve(here, "../../../shared/src/prompts/teach.md"), "utf8").trim()

const session = Session.Info.make({
  id: Session.ID.make("ses_teach_mode"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})

const fakeOpenAIModel = SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "fake-gpt", provider: "fake-openai" }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 128_000, output: 8_000 },
})

const fakeAnthropicModel = SessionRunnerModel.resolved(
  AnthropicMessages.route.model({ id: "fake-claude", provider: "fake-anthropic" }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 128_000, output: 8_000 },
  },
)

const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})

describe("PendixTeachPlugin with fake models", () => {
  it.effect("adds teach instructions to the system prompt when on, removes them when off, across any model and agent", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const plugins = yield* Plugin.Service
      const pluginHost = yield* PluginHost.make(plugins, "test")
      yield* PendixTeachPlugin.Plugin.effect(pluginHost)

      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const capturedSystemPrompts: string[][] = []

      const runFakeModelCall = (model: SessionRunnerModel.Resolved, agentName: string) =>
        Effect.gen(function* () {
          const prepared = yield* requests.primary({
            session,
            agent: Agent.ID.make(agentName),
            model,
            system: [SystemPart.make("Base agent system prompt")],
            messages: [],
          })
          const systemTexts = prepared.request.system.map((part) => part.text)
          capturedSystemPrompts.push(systemTexts)
          return systemTexts
        })

      // Off by default.
      const offSystem = yield* runFakeModelCall(fakeOpenAIModel, "build")
      expect(offSystem).toEqual(["Base agent system prompt"])

      // Turn teach mode on: both OpenAI and Anthropic fake models and different agents receive teach.md.
      PendixTeachPlugin.writeTeachModeEnabled(global.config, true)
      const onOpenAI = yield* runFakeModelCall(fakeOpenAIModel, "build")
      expect(onOpenAI).toContain(teachPromptText)

      const onAnthropicPlan = yield* runFakeModelCall(fakeAnthropicModel, "plan")
      expect(onAnthropicPlan).toContain(teachPromptText)

      // Turn teach mode off: instructions are removed again.
      PendixTeachPlugin.writeTeachModeEnabled(global.config, false)
      const offAgain = yield* runFakeModelCall(fakeOpenAIModel, "build")
      expect(offAgain).toEqual(["Base agent system prompt"])
      expect(capturedSystemPrompts).toHaveLength(4)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("keeps teach instructions injected under class and self locks even when local toggle is off", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const plugins = yield* Plugin.Service
      const pluginHost = yield* PluginHost.make(plugins, "test")
      yield* PendixTeachPlugin.Plugin.effect(pluginHost)

      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const meCachePath = path.join(global.config, "me-cache.json")

      PendixTeachPlugin.writeTeachModeEnabled(global.config, false)

      // Class lock forces teach mode on.
      yield* Effect.promise(() =>
        writeFile(meCachePath, JSON.stringify({ id: "u1", display_name: "Ada", teach_lock: "class" }), "utf8"),
      )
      const classPrepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: fakeOpenAIModel,
        system: [SystemPart.make("Base prompt")],
        messages: [],
      })
      expect(classPrepared.request.system.map((part) => part.text)).toContain(teachPromptText)

      // Self lock also forces teach mode on until /me cache changes back to none.
      yield* Effect.promise(() =>
        writeFile(meCachePath, JSON.stringify({ id: "u1", display_name: "Ada", teach_lock: "self" }), "utf8"),
      )
      const selfPrepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: fakeOpenAIModel,
        system: [SystemPart.make("Base prompt")],
        messages: [],
      })
      expect(selfPrepared.request.system.map((part) => part.text)).toContain(teachPromptText)

      // Unlocking in /me removes the forced instructions when local toggle is off.
      yield* Effect.promise(() =>
        writeFile(meCachePath, JSON.stringify({ id: "u1", display_name: "Ada", teach_lock: "none" }), "utf8"),
      )
      const unlockedPrepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: fakeOpenAIModel,
        system: [SystemPart.make("Base prompt")],
        messages: [],
      })
      expect(unlockedPrepared.request.system.map((part) => part.text)).toEqual(["Base prompt"])
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
})

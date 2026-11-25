import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@pendix/util/global"
import { Effect, Option } from "effect"
import { expect, mock, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../src/config"
import { Server } from "../src/commands/commands"
import type { MiniCommandInput } from "../src/mini"
import { OPENCODE_VERSION } from "../src/version"
import { seedTestAuthSession } from "./fixture/environment"

test("mini handler passes resolved CLI keybinds to the runtime", async () => {
  const root = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const configDirectory = path.join(root, "config")
  const stateDirectory = path.join(root, "state")
  await mkdir(configDirectory, { recursive: true })
  seedTestAuthSession(configDirectory)
  const prevApiUrl = process.env.PENDIX_API_URL
  const prevDisableKeychain = process.env.PENDIX_DISABLE_KEYCHAIN
  process.env.PENDIX_API_URL = "http://127.0.0.1:1"
  process.env.PENDIX_DISABLE_KEYCHAIN = "1"
  await Bun.write(
    path.join(configDirectory, "cli.json"),
    JSON.stringify({
      keybinds: { "composer.subagent.interrupt": "ctrl+i" },
      leader: { timeout: 321 },
    }),
  )
  let received: MiniCommandInput["tuiConfig"]
  const mini = await import("../src/mini")
  mock.module("../src/mini", () => ({
    ...mini,
    validateMiniTerminal() {},
    runMini(input: Pick<MiniCommandInput, "tuiConfig">) {
      received = input.tuiConfig
      return Promise.resolve()
    },
  }))
  const handler = (await import("../src/commands/handlers/mini")).default
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] }),
  })

  try {
    await Effect.runPromise(
      handler({
        continue: false,
        session: Option.none(),
        fork: false,
        replay: true as never,
        replayLimit: Option.none(),
        model: Option.none(),
        agent: Option.none(),
        prompt: Option.none(),
        demo: false,
      }).pipe(
        Effect.provideService(Server, Option.some(server.url.toString())),
        Effect.provide(Config.layer),
        Effect.provide(Global.layerWith({ config: configDirectory, state: stateDirectory })),
        Effect.provide(NodeFileSystem.layer),
        Effect.scoped,
      ),
    )

    const config = await received
    expect(config?.leader.timeout).toBe(321)
    expect(config?.keybinds.get("composer.subagent.interrupt")).toMatchObject([{ key: "ctrl+i" }])
  } finally {
    if (prevApiUrl === undefined) delete process.env.PENDIX_API_URL
    else process.env.PENDIX_API_URL = prevApiUrl
    if (prevDisableKeychain === undefined) delete process.env.PENDIX_DISABLE_KEYCHAIN
    else process.env.PENDIX_DISABLE_KEYCHAIN = prevDisableKeychain
    server.stop(true)
    mock.restore()
    await rm(root, { recursive: true, force: true })
  }
})

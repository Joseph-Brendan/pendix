import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Console, Effect, Option, Stdio } from "effect"
import { Commands, Server } from "../src/commands/commands"
import { Runtime } from "../src/framework/runtime"

test("login, logout, and whoami appear in root help while auth login stays available for integrations", async () => {
  const [root, login, logout, whoami, auth] = await Promise.all([
    run(["--help"]),
    run(["login", "--help"]),
    run(["logout", "--help"]),
    run(["whoami", "--help"]),
    run(["auth", "login", "--help"]),
  ])

  expect(root.help).toMatch(/^\s+auth\s/m)
  expect(root.help).toMatch(/^\s+login\s/m)
  expect(root.help).toMatch(/^\s+logout\s/m)
  expect(root.help).toMatch(/^\s+whoami\s/m)
  expect(login.help).toContain("Sign in to your Pendix account")
  expect(logout.help).toContain("Sign out of your Pendix account")
  expect(whoami.help).toContain("Show your signed-in Pendix account")
  expect(auth.help).toContain("connect an integration")
})

test("auth login parses integration arguments cleanly and login dispatches to the Pendix login command", async () => {
  const url = "http://127.0.0.1:4096"
  const args = ["openai", "--method", "api", "--answer", "key=value", "--server", url]
  const [login, auth] = await Promise.all([run(["login"]), run(["auth", "login", ...args])])

  expect(login.calls).toEqual([{ command: "login", input: {}, server: Option.none() }])
  expect(auth.calls).toEqual([
    {
      command: "auth login",
      input: { target: Option.some("openai"), method: Option.some("api"), answer: ["key=value"] },
      server: Option.some(url),
    },
  ])
})

async function run(args: ReadonlyArray<string>) {
  const pages: string[] = []
  const calls: Array<{ command: string; input: unknown; server: unknown }> = []
  const capture = (command: string) => async () => ({
    default: (input: unknown) =>
      Effect.gen(function* () {
        calls.push({ command, input, server: yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten)) })
      }),
  })
  await Effect.runPromise(
    Runtime.run(
      Commands,
      [
        { spec: Commands.commands.login.spec, load: capture("login") },
        { spec: Commands.commands.logout.spec, load: capture("logout") },
        { spec: Commands.commands.whoami.spec, load: capture("whoami") },
        { spec: Commands.commands.auth.commands.login.spec, load: capture("auth login") },
      ],
      { version: "test" },
    ).pipe(
      Effect.provideService(
        Console.Console,
        Object.assign(Object.create(console), { log: (page: string) => pages.push(page) }),
      ),
      Effect.provide(Stdio.layerTest({ args: Effect.succeed(args) })),
      Effect.provide(NodeServices.layer),
    ),
  )
  return { help: pages.join("\n"), calls }
}

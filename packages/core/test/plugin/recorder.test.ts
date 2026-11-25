import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Stream } from "effect"
import { Global } from "@pendix/util/global"
import { PendixRecorderPlugin } from "../../src/plugin/recorder.js"
import { tmpdir } from "../fixture/tmpdir.js"

describe("PendixRecorderPlugin core hook", () => {
  test("subscribes to session events and writes a sanitized local JSONL file into the pendix data dir", async () => {
    await using dir = await tmpdir()
    const sessionID = "ses_core_hook_1"
    const events = [
      {
        type: "session.created",
        created: 1700000000000,
        data: {
          sessionID,
          location: { directory: "/Users/learner/code/budget-tracker" },
          model: { providerID: "google", id: "gemini-2.5-pro" },
        },
      },
      {
        type: "session.inbox.enqueued",
        created: 1700000001000,
        data: {
          sessionID,
          item: {
            type: "user",
            payload: { text: "Install stripe and update @src/billing.ts" },
          },
        },
      },
      {
        type: "session.execution.started",
        created: 1700000002000,
        data: { sessionID },
      },
      {
        type: "session.tool.input.started",
        created: 1700000002500,
        data: { sessionID, id: "call_1", name: "shell" },
      },
      {
        type: "session.tool.called",
        created: 1700000002600,
        data: { sessionID, id: "call_1", input: { command: "npm install stripe --save" } },
      },
      {
        type: "session.tool.success",
        created: 1700000002900,
        data: { sessionID, id: "call_1" },
      },
      {
        type: "session.text.ended",
        created: 1700000003000,
        data: { sessionID, text: "Installed the package." },
      },
      {
        type: "session.execution.succeeded",
        created: 1700000003100,
        data: { sessionID },
      },
    ]

    let subscribedTypes: readonly string[] = []
    const host = {
      event: {
        subscribe(input: { readonly types: readonly string[] }) {
          subscribedTypes = input.types
          return Stream.fromIterable(events)
        },
      },
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // SAFETY: Test stub implements the event.subscribe contract consumed by PendixRecorderPlugin.
          yield* PendixRecorderPlugin.Plugin.effect(host as never)
          yield* Effect.sleep("50 millis")
        }).pipe(Effect.provide(Global.layerWith({ data: dir.path }))),
      ),
    )

    expect(subscribedTypes).toContain("session.created")
    expect(subscribedTypes).toContain("session.inbox.enqueued")
    expect(subscribedTypes).toContain("session.tool.called")

    const filePath = path.join(dir.path, "sessions", `${sessionID}.jsonl`)
    const raw = await readFile(filePath, "utf8")
    const records = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(records.map((r) => r.type)).toEqual(["start", "prompt", "turn", "end"])
    expect(records[0]).toMatchObject({
      type: "start",
      session_id: sessionID,
      project_name: "budget-tracker",
      provider: "google",
      model: "gemini-2.5-pro",
    })
    expect(records[2]).toMatchObject({
      type: "turn",
      commands: ["npm"],
      tools: { shell: 1 },
      errored: false,
      reply_preview: "Installed the package.",
    })
    expect(records[3]).toMatchObject({ type: "end", reason: "quit" })
    expect(raw).not.toContain("--save")
    expect(raw).not.toContain("/Users/learner/code")
  })
})

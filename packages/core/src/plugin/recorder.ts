export * as PendixRecorderPlugin from "./recorder.js"

import { define } from "@pendix/plugin/effect/plugin"
import { createSessionRecorder } from "@pendix/recorder"
import { Global } from "@pendix/util/global"
import { Effect, Stream } from "effect"

const RECORDED_EVENT_TYPES = [
  "session.created",
  "session.model.selected",
  "session.inbox.enqueued",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.failed",
  "session.text.ended",
  "session.tool.input.started",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.synthetic",
  "session.archived",
  "session.deleted",
] as const

export const Plugin = define({
  id: "pendix.recorder",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const runFork = Effect.runForkWith(yield* Effect.context<never>())
    const recorder = createSessionRecorder({
      dataDir: global.data,
      onError(error, context) {
        runFork(Effect.logWarning("pendix recorder write failed; event dropped", { filePath: context.filePath, error }))
      },
    })

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        recorder.closeAll("quit")
        await recorder.flush()
      }),
    )

    yield* ctx.event.subscribe({ types: RECORDED_EVENT_TYPES }).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          recorder.handleEngineEvent(event)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

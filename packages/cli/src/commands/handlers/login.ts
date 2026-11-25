import { Global } from "@pendix/util/global"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { loginPendix } from "../../pendix-auth/client"
import { createAuthStorage } from "../../pendix-auth/storage"

export default Runtime.handler(Commands.commands.login, () =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const storage = createAuthStorage({ configDir: global.config })
    const result = yield* Effect.promise(() => loginPendix({ storage }))
    if (!result.ok) {
      process.exitCode = 1
    }
  }),
)

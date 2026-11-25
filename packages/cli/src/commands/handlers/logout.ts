import { Global } from "@pendix/util/global"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { logoutPendix } from "../../pendix-auth/client"
import { createAuthStorage } from "../../pendix-auth/storage"

export default Runtime.handler(Commands.commands.logout, () =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const storage = createAuthStorage({ configDir: global.config })
    const result = yield* Effect.promise(() => logoutPendix({ storage }))
    process.stdout.write(result.hadToken ? "Signed out.\n" : "Not signed in.\n")
  }),
)

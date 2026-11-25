import { Global } from "@pendix/util/global"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { whoamiPendix } from "../../pendix-auth/client"
import { createAuthStorage } from "../../pendix-auth/storage"

export default Runtime.handler(Commands.commands.whoami, (input) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const storage = createAuthStorage({ configDir: global.config })
    const result = yield* Effect.promise(() => whoamiPendix({ storage }))

    if (!result.signedIn) {
      if (input.json) {
        process.stdout.write(`${JSON.stringify({ signed_in: false, message: result.message })}\n`)
      } else {
        process.stdout.write(`${result.message}\n`)
      }
      process.exitCode = 1
      return
    }

    if (input.json) {
      process.stdout.write(
        `${JSON.stringify({
          signed_in: true,
          offline: result.offline,
          id: result.account.id,
          display_name: result.account.display_name,
          plan: result.account.plan,
          credits: result.account.credits,
          account_kind: result.account.account_kind,
          teach_lock: result.account.teach_lock,
          entitlements: result.account.entitlements,
        })}\n`,
      )
      return
    }

    process.stdout.write(`Name: ${result.account.display_name}\n`)
    process.stdout.write(`Plan: ${result.account.plan}\n`)
    process.stdout.write(`Credits: ${result.account.credits}\n`)
    if (result.offline) {
      process.stdout.write("Status: offline\n")
    }
  }),
)

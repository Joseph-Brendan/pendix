import { ensurePluginRuntime, provides } from "@pendix/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@pendix/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@pendix/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})

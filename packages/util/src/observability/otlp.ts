import { Effect, Layer } from "effect"
import { runID } from "./shared.js"

export interface Options {
  readonly endpoint?: string
  readonly headers?: string
}

export interface App {
  readonly client: string
  readonly version: string
  readonly channel: string
}

function resourceAttributes() {
  const value = process.env.OTEL_RESOURCE_ATTRIBUTES
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

export function resource(app: App = { client: "pendix", version: "unknown", channel: "local" }): {
  serviceName: string
  serviceVersion: string
  attributes: Record<string, string>
} {
  return {
    serviceName: "pendix",
    serviceVersion: app.version,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": app.channel,
      "pendix.client": app.client,
      "pendix.run": runID(),
      "service.instance.id": runID(),
    },
  }
}

export function loggers(_options: Options | undefined, _app: App) {
  // Telemetry export is disabled in Pendix.
  return []
}

export const tracingLayer = Effect.fnUntraced(function* (_options: Options | undefined, _app: App) {
  // Telemetry export is disabled in Pendix.
  return Layer.empty
})

export * as Otlp from "./otlp.js"

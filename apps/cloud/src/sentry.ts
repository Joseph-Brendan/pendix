import * as Sentry from "@sentry/node"

let sentryEnabled = false

export function initSentry(dsn: string | undefined, environment: string): boolean {
  const trimmed = dsn?.trim()
  if (!trimmed) {
    sentryEnabled = false
    return false
  }
  Sentry.init({
    dsn: trimmed,
    environment,
    sendDefaultPii: false,
  })
  sentryEnabled = true
  return true
}

export function isSentryEnabled(): boolean {
  return sentryEnabled
}

export function captureException(error: unknown, context?: { readonly requestId?: string }): void {
  if (!sentryEnabled) return
  Sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag("request_id", context.requestId)
    Sentry.captureException(error)
  })
}

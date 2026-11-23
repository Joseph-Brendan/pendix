export * as ConsoleAccess from "./console-access.js"

import type { Credential } from "./credential.js"

export const defaultServer = "https://pendix.dev/console"

/** The console server a credential signed in to. */
export function server(value: Credential.Value) {
  return typeof value.metadata?.server === "string" ? value.metadata.server : defaultServer
}

/** Authenticates a Console request as the credential's member, in the workspace the sign-in chose. */
export function headers(value: Credential.Key | Credential.OAuth): Record<string, string> {
  const orgID = value.metadata?.orgID
  return {
    authorization: `Bearer ${value.type === "oauth" ? value.access : value.key}`,
    ...(typeof orgID === "string" ? { "x-org-id": orgID } : {}),
  }
}

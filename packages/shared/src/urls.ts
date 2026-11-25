// Single source of truth for the Pendix domain and default URLs.
export const PENDIX_DOMAIN = "pendix.dev" as const
export const DEFAULT_PENDIX_API_URL = `https://api.${PENDIX_DOMAIN}` as const
export const DEFAULT_PENDIX_WEB_URL = `https://app.${PENDIX_DOMAIN}` as const

export function resolvePendixApiUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.PENDIX_API_URL?.trim()
  if (configured) return configured.replace(/\/+$/, "")
  return DEFAULT_PENDIX_API_URL
}

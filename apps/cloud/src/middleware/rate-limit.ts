import type { Context, MiddlewareHandler } from "hono"
import { AppError } from "../errors.js"
import type { RequestVariables } from "./request-id.js"

export interface RateLimitOptions {
  readonly ipMax: number
  readonly ipWindowMs: number
  readonly userMax: number
  readonly userWindowMs: number
  readonly now?: () => number
  readonly resolveUserId?: (c: Context<{ Variables: RequestVariables }>) => string | undefined
}

interface Counter {
  count: number
  resetAt: number
}

function clientIp(c: Context<{ Variables: RequestVariables }>): string {
  const forwarded = c.req.header("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = c.req.header("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}

function consume(store: Map<string, Counter>, key: string, max: number, windowMs: number, now: number) {
  const existing = store.get(key)
  if (!existing || now >= existing.resetAt) {
    const next: Counter = { count: 1, resetAt: now + windowMs }
    store.set(key, next)
    return { allowed: true, remaining: Math.max(0, max - 1), resetAt: next.resetAt }
  }
  if (existing.count >= max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }
  existing.count += 1
  return { allowed: true, remaining: Math.max(0, max - existing.count), resetAt: existing.resetAt }
}

export function rateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler<{ Variables: RequestVariables }> {
  const ipStore = new Map<string, Counter>()
  const userStore = new Map<string, Counter>()
  const getNow = options.now ?? (() => Date.now())

  return async (c, next) => {
    const now = getNow()
    const ipResult = consume(ipStore, clientIp(c), options.ipMax, options.ipWindowMs, now)
    c.header("x-ratelimit-limit", String(options.ipMax))
    c.header("x-ratelimit-remaining", String(ipResult.remaining))
    c.header("x-ratelimit-reset", String(Math.ceil(ipResult.resetAt / 1000)))
    if (!ipResult.allowed) {
      throw new AppError(429, "RATE_LIMITED", "Too many requests")
    }

    const userId = c.get("userId") ?? options.resolveUserId?.(c)
    if (userId) {
      c.set("userId", userId)
      const userResult = consume(userStore, userId, options.userMax, options.userWindowMs, now)
      if (!userResult.allowed) {
        c.header("x-ratelimit-limit", String(options.userMax))
        c.header("x-ratelimit-remaining", "0")
        c.header("x-ratelimit-reset", String(Math.ceil(userResult.resetAt / 1000)))
        throw new AppError(429, "RATE_LIMITED", "Too many requests")
      }
    }

    await next()
  }
}

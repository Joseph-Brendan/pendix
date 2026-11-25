import { BRAND_CSS_VARIABLES } from "@pendix/shared/brand"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"
import {
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_REFRESH_TTL_MS,
  DEVICE_TOKEN_TTL_MS,
  generateOpaqueToken,
  hashToken,
  type CloudAuth,
} from "../auth.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { AppError } from "../errors.js"
import {
  requireActiveAccount,
  requireAuth,
  resolveSessionUser,
  type AuthenticatedUser,
  type AuthVariables,
} from "../middleware/auth.js"

const DeviceStartSchema = z.object({
  name: z.string().trim().max(120).optional(),
  client_id: z.string().trim().min(1).max(80).optional(),
})

const DeviceActionSchema = z.object({
  user_code: z.string().trim().min(1).max(32),
  name: z.string().trim().max(120).optional(),
})

const DeviceTokenSchema = z.object({
  device_code: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
})

const DeviceRefreshSchema = z.object({
  refresh_token: z.string().trim().min(1),
})

const UuidSchema = z.string().uuid()

export interface DeviceRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly apiUrl: string
  readonly now: () => number
}

function normalizeUserCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function isFormRequest(c: Context): boolean {
  const ct = (c.req.header("content-type") ?? "").toLowerCase()
  return ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")
}

async function readBodyObject(c: Context): Promise<Record<string, unknown>> {
  const ct = (c.req.header("content-type") ?? "").toLowerCase()
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await c.req.parseBody()
    return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v : ""]))
  }
  const text = await c.req.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as Record<string, unknown>
}

function renderHtmlShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${BRAND_CSS_VARIABLES}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pendix-off-white);
      color: var(--pendix-ink);
      font-family: var(--pendix-font-ui);
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--pendix-white);
      border: 1px solid var(--pendix-line);
      border-radius: var(--pendix-radius);
      padding: 28px;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 18px;
      margin-bottom: 18px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--pendix-hot-orange);
      display: inline-block;
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; line-height: 1.5; color: var(--pendix-muted); margin: 0 0 16px; }
    .code {
      font-family: var(--pendix-font-code);
      font-size: 24px;
      letter-spacing: 0.14em;
      text-align: center;
      padding: 14px;
      background: var(--pendix-off-white);
      border: 1px solid var(--pendix-line);
      border-radius: var(--pendix-radius);
      margin-bottom: 18px;
    }
    label { display: block; font-size: 13px; margin-bottom: 6px; font-weight: 500; }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--pendix-line);
      border-radius: var(--pendix-radius);
      font-size: 14px;
      margin-bottom: 14px;
      font-family: inherit;
    }
    input:focus {
      outline: 2px solid var(--pendix-hot-orange);
      outline-offset: 1px;
    }
    .actions { display: flex; gap: 10px; margin-top: 8px; }
    button {
      flex: 1;
      padding: 11px 16px;
      border-radius: var(--pendix-radius);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--pendix-line);
      background: var(--pendix-white);
      color: var(--pendix-ink);
    }
    button.primary {
      background: var(--pendix-hot-orange);
      border-color: var(--pendix-hot-orange);
      color: var(--pendix-white);
    }
    .notice {
      padding: 12px 14px;
      border-radius: var(--pendix-radius);
      border: 1px solid var(--pendix-line);
      background: var(--pendix-off-white);
      font-size: 14px;
      color: var(--pendix-ink);
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo"><span class="dot" aria-hidden="true"></span><span>pendix</span></div>
    ${bodyHtml}
  </main>
</body>
</html>`
}

function renderBlockedAccountReason(user: AuthenticatedUser): string {
  if (user.status === "pending_guardian") {
    return "Your account is waiting for a parent or guardian to approve it. Ask them to open the approval link sent to their email before you sign in on a device."
  }
  if (user.status === "pending_onboarding") {
    return "Finish entering your date of birth to activate your account before signing in on a device."
  }
  if (user.status === "pending_verification") {
    return "Verify your email address before signing in on a device."
  }
  if (user.status === "paused") {
    return "Your account is paused. You cannot approve a device right now."
  }
  return "Your account is closed. You cannot approve a device."
}

export function createDeviceRoutes(deps: DeviceRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)

  router.post("/device/start", async (c) => {
    const raw = await readBodyObject(c)
    const body = DeviceStartSchema.parse(raw)
    const clientId = body.client_id ?? "pendix-cli"
    const deviceName = body.name ?? ""

    const created = (await deps.auth.api.deviceCode({
      body: { client_id: clientId },
    })) as {
      device_code: string
      user_code: string
    }

    const expiresAt = new Date(deps.now() + DEVICE_CODE_TTL_MS)
    await deps.db
      .update(schema.deviceCodes)
      .set({
        device_name: deviceName,
        expires_at: expiresAt,
        polling_interval: DEVICE_POLL_INTERVAL_SECONDS * 1000,
      })
      .where(eq(schema.deviceCodes.device_code, created.device_code))

    const verificationUrl = new URL("/device/verify", deps.apiUrl)
    verificationUrl.searchParams.set("code", created.user_code)

    return c.json({
      device_code: created.device_code,
      user_code: created.user_code,
      verification_url: verificationUrl.toString(),
      interval: DEVICE_POLL_INTERVAL_SECONDS,
      expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    })
  })

  router.get("/device/verify", async (c) => {
    const rawCode = c.req.query("code") ?? c.req.query("user_code") ?? ""
    const code = rawCode ? normalizeUserCode(rawCode) : ""
    const errorMsg = c.req.query("error") ?? ""
    const user = await resolveSessionUser(c, deps)

    let deviceLabel = ""
    if (code) {
      const [record] = await deps.db.select().from(schema.deviceCodes).where(eq(schema.deviceCodes.user_code, code))
      if (record?.device_name) deviceLabel = record.device_name
    }

    if (!user) {
      const codeBlock = code ? `<div class="code">${escapeHtml(code)}</div>` : ""
      const errBlock = errorMsg ? `<div class="notice">${escapeHtml(errorMsg)}</div><p></p>` : ""
      return c.html(
        renderHtmlShell(
          "Sign in to Pendix",
          `<h1>Sign in to connect your device</h1>
          <p>Check that this code matches what you see in your terminal or editor.</p>
          ${codeBlock}
          ${errBlock}
          <form method="post" action="/device/verify/signin">
            <input type="hidden" name="code" value="${escapeHtml(code)}" />
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required autocomplete="email" />
            <label for="password">Password</label>
            <input id="password" name="password" type="password" required autocomplete="current-password" />
            <div class="actions">
              <button class="primary" type="submit">Sign in</button>
            </div>
          </form>`,
        ),
      )
    }

    if (user.status !== "active") {
      return c.html(
        renderHtmlShell(
          "Device approval unavailable",
          `<h1>Cannot approve this device yet</h1>
          <div class="notice">${escapeHtml(renderBlockedAccountReason(user))}</div>`,
        ),
      )
    }

    const codeSection = code
      ? `<div class="code">${escapeHtml(code)}</div><input type="hidden" name="user_code" value="${escapeHtml(code)}" />`
      : `<label for="user_code">Device code</label><input id="user_code" name="user_code" required />`
    const deviceLine = deviceLabel ? `<p>Device: ${escapeHtml(deviceLabel)}</p>` : ""

    return c.html(
      renderHtmlShell(
        "Approve device",
        `<h1>Confirm this device</h1>
        <p>Signed in as ${escapeHtml(user.display_name)}. Confirm the code matches your device.</p>
        ${deviceLine}
        <form method="post" action="/device/approve">
          ${codeSection}
          <div class="actions">
            <button class="primary" type="submit">This is me</button>
          </div>
        </form>
        ${
          code
            ? `<form method="post" action="/device/deny" style="margin-top: 10px;">
                <input type="hidden" name="user_code" value="${escapeHtml(code)}" />
                <div class="actions"><button type="submit">Cancel</button></div>
              </form>`
            : ""
        }`,
      ),
    )
  })

  router.post("/device/verify/signin", async (c) => {
    const body = await readBodyObject(c)
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""
    const code = typeof body.code === "string" ? normalizeUserCode(body.code) : ""

    const response = await deps.auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    })

    const redirectUrl = new URL("/device/verify", deps.apiUrl)
    if (code) redirectUrl.searchParams.set("code", code)

    if (!response.ok) {
      redirectUrl.searchParams.set("error", "Invalid email or password.")
      return c.redirect(redirectUrl.pathname + redirectUrl.search, 303)
    }

    const headers = new Headers()
    const setCookie = response.headers.get("set-cookie")
    if (setCookie) headers.set("set-cookie", setCookie)
    headers.set("location", redirectUrl.pathname + redirectUrl.search)
    return new Response(null, { status: 303, headers })
  })

  router.post("/device/approve", authMiddleware, requireActiveAccount(), async (c) => {
    const user = c.get("user")!
    const formSubmit = isFormRequest(c)
    const body = DeviceActionSchema.parse(await readBodyObject(c))
    const code = normalizeUserCode(body.user_code)

    const [record] = await deps.db.select().from(schema.deviceCodes).where(eq(schema.deviceCodes.user_code, code))
    if (!record) {
      throw new AppError(400, "INVALID_USER_CODE", "That device code was not found.")
    }
    if (record.expires_at.getTime() <= deps.now()) {
      await deps.db.delete(schema.deviceCodes).where(eq(schema.deviceCodes.id, record.id))
      throw new AppError(400, "EXPIRED_TOKEN", "That device code has expired. Start again from your device.")
    }
    if (record.status !== "pending") {
      throw new AppError(400, "DEVICE_CODE_ALREADY_PROCESSED", "That device code has already been used.")
    }

    await deps.db
      .update(schema.deviceCodes)
      .set({
        status: "approved",
        user_id: user.id,
        ...(body.name ? { device_name: body.name } : {}),
      })
      .where(eq(schema.deviceCodes.id, record.id))

    if (formSubmit) {
      return c.html(
        renderHtmlShell(
          "Device approved",
          `<h1>Device approved</h1>
          <p>You can return to your terminal or editor now.</p>`,
        ),
      )
    }
    return c.json({ ok: true, status: "approved" })
  })

  router.post("/device/deny", authMiddleware, async (c) => {
    const formSubmit = isFormRequest(c)
    const body = DeviceActionSchema.parse(await readBodyObject(c))
    const code = normalizeUserCode(body.user_code)

    const [record] = await deps.db.select().from(schema.deviceCodes).where(eq(schema.deviceCodes.user_code, code))
    if (!record) {
      throw new AppError(400, "INVALID_USER_CODE", "That device code was not found.")
    }
    if (record.status === "pending") {
      await deps.db.update(schema.deviceCodes).set({ status: "denied" }).where(eq(schema.deviceCodes.id, record.id))
    }

    if (formSubmit) {
      return c.html(
        renderHtmlShell(
          "Device cancelled",
          `<h1>Sign-in cancelled</h1>
          <p>No device was connected to your account.</p>`,
        ),
      )
    }
    return c.json({ ok: true, status: "denied" })
  })

  router.post("/device/token", async (c) => {
    const body = DeviceTokenSchema.parse(await readBodyObject(c))
    const nowMs = deps.now()

    const [record] = await deps.db
      .select()
      .from(schema.deviceCodes)
      .where(eq(schema.deviceCodes.device_code, body.device_code))

    if (!record) {
      return c.json({ error: "invalid_grant", error_description: "Invalid device code." }, 400)
    }

    if (record.expires_at.getTime() <= nowMs) {
      await deps.db.delete(schema.deviceCodes).where(eq(schema.deviceCodes.id, record.id))
      return c.json({ error: "expired_token", error_description: "Device code expired." }, 400)
    }

    const intervalMs = record.polling_interval ?? DEVICE_POLL_INTERVAL_SECONDS * 1000
    if (record.last_polled_at && nowMs - record.last_polled_at.getTime() < intervalMs) {
      return c.json({ error: "slow_down", error_description: "Polling too fast. Wait before trying again." }, 400)
    }

    await deps.db
      .update(schema.deviceCodes)
      .set({ last_polled_at: new Date(nowMs) })
      .where(eq(schema.deviceCodes.id, record.id))

    if (record.status === "pending") {
      return c.json({ error: "authorization_pending", error_description: "Waiting for approval." }, 400)
    }

    if (record.status === "denied") {
      await deps.db.delete(schema.deviceCodes).where(eq(schema.deviceCodes.id, record.id))
      return c.json({ error: "access_denied", error_description: "Device sign-in was denied." }, 400)
    }

    if (record.status !== "approved" || !record.user_id) {
      return c.json({ error: "invalid_grant", error_description: "Device code cannot be redeemed." }, 400)
    }

    const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.id, record.user_id))
    if (!user || user.status !== "active") {
      return c.json({ error: "access_denied", error_description: "Account is not active." }, 403)
    }

    const [claimed] = await deps.db
      .delete(schema.deviceCodes)
      .where(and(eq(schema.deviceCodes.id, record.id), eq(schema.deviceCodes.status, "approved")))
      .returning()

    if (!claimed) {
      return c.json({ error: "invalid_grant", error_description: "Device code already redeemed." }, 400)
    }

    const deviceToken = generateOpaqueToken("pdx_dev")
    const refreshToken = generateOpaqueToken("pdx_ref")
    const deviceName = body.name || claimed.device_name || "Pendix device"
    const expiresAt = new Date(nowMs + DEVICE_TOKEN_TTL_MS)
    const refreshExpiresAt = new Date(nowMs + DEVICE_REFRESH_TTL_MS)

    const [device] = await deps.db
      .insert(schema.devices)
      .values({
        user_id: user.id,
        name: deviceName,
        token_hash: hashToken(deviceToken),
        refresh_token_hash: hashToken(refreshToken),
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
        last_used_at: new Date(nowMs),
      })
      .returning()

    c.header("Cache-Control", "no-store")
    return c.json({
      device_id: device!.id,
      device_name: device!.name,
      token_type: "Bearer",
      access_token: deviceToken,
      device_token: deviceToken,
      refresh_token: refreshToken,
      expires_in: Math.floor(DEVICE_TOKEN_TTL_MS / 1000),
    })
  })

  router.post("/device/refresh", async (c) => {
    const body = DeviceRefreshSchema.parse(await readBodyObject(c))
    const nowMs = deps.now()

    const [existing] = await deps.db
      .select()
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.refresh_token_hash, hashToken(body.refresh_token)),
          isNull(schema.devices.revoked_at),
        ),
      )

    if (!existing || (existing.refresh_expires_at && existing.refresh_expires_at.getTime() <= nowMs)) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.")
    }

    const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.id, existing.user_id))
    if (!user || user.status !== "active") {
      throw new AppError(403, "ACCOUNT_INACTIVE", "Account is not active.")
    }

    const nextDeviceToken = generateOpaqueToken("pdx_dev")
    const nextRefreshToken = generateOpaqueToken("pdx_ref")
    const expiresAt = new Date(nowMs + DEVICE_TOKEN_TTL_MS)
    const refreshExpiresAt = new Date(nowMs + DEVICE_REFRESH_TTL_MS)

    await deps.db
      .update(schema.devices)
      .set({
        token_hash: hashToken(nextDeviceToken),
        refresh_token_hash: hashToken(nextRefreshToken),
        expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
        last_used_at: new Date(nowMs),
      })
      .where(eq(schema.devices.id, existing.id))

    c.header("Cache-Control", "no-store")
    return c.json({
      device_id: existing.id,
      device_name: existing.name,
      token_type: "Bearer",
      access_token: nextDeviceToken,
      device_token: nextDeviceToken,
      refresh_token: nextRefreshToken,
      expires_in: Math.floor(DEVICE_TOKEN_TTL_MS / 1000),
    })
  })

  router.get("/devices", authMiddleware, async (c) => {
    const user = c.get("user")!
    const rows = await deps.db
      .select({
        id: schema.devices.id,
        name: schema.devices.name,
        last_used_at: schema.devices.last_used_at,
        expires_at: schema.devices.expires_at,
        created_at: schema.devices.created_at,
      })
      .from(schema.devices)
      .where(and(eq(schema.devices.user_id, user.id), isNull(schema.devices.revoked_at)))
      .orderBy(desc(schema.devices.created_at))

    return c.json({ devices: rows })
  })

  router.delete("/devices/:id", authMiddleware, async (c) => {
    const user = c.get("user")!
    const parsedId = UuidSchema.safeParse(c.req.param("id"))
    if (!parsedId.success) {
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found.")
    }

    const [revoked] = await deps.db
      .update(schema.devices)
      .set({ revoked_at: new Date(deps.now()) })
      .where(
        and(
          eq(schema.devices.id, parsedId.data),
          eq(schema.devices.user_id, user.id),
          isNull(schema.devices.revoked_at),
        ),
      )
      .returning({ id: schema.devices.id })

    if (!revoked) {
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found.")
    }

    return c.json({ ok: true, revoked: true, id: revoked.id })
  })

  return router
}

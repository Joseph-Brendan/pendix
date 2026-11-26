import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../src/app.js"
import { hashToken } from "../src/auth.js"
import { schema } from "../src/db/schema.js"
import { createLogger } from "../src/logger.js"
import { createFakeMailer } from "../src/mailer.js"
import { createTestDatabase, type TestDatabase } from "./helpers/db.js"

const AUTH_SECRET = "test-auth-secret-32-bytes-long-0000"
const LOOK_ALIKE_CHARS = /[01ILO]/

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  return header
    .split(/,(?=\s*[^;]+=[^;]+)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ")
}

function extractVerifyUrl(text: string): string {
  const match = /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i.exec(text)
  if (!match) throw new Error(`No verify URL found in email: ${text}`)
  return match[0]
}

async function createSignedInUser(
  app: ReturnType<typeof createApp>,
  mailer: ReturnType<typeof createFakeMailer>,
  input: {
    readonly email: string
    readonly display_name: string
    readonly dob: string
    readonly guardian_email?: string
  },
) {
  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      password: "Password123!",
      terms_version: "2026-01",
      privacy_version: "2026-01",
    }),
  })
  expect(signupRes.status).toBe(201)
  const { user } = (await signupRes.json()) as { user: { id: string; status: string } }

  const email = mailer.sent.find((m) => m.to === input.email)
  expect(email).toBeDefined()
  const verifyUrl = new URL(extractVerifyUrl(email!.text))
  await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)

  const loginRes = await app.request("/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: "Password123!" }),
  })
  expect(loginRes.status).toBe(200)
  return { userId: user.id, cookie: extractCookie(loginRes) }
}

describe("device sign-in flow and device management", () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase()
  })

  afterAll(async () => {
    if (testDb) await testDb.close()
  })

  it("happy path: starts device flow, approves on verification page, returns device and refresh tokens, and authenticates /me", async () => {
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now: () => currentTime,
    })

    const { cookie } = await createSignedInUser(app, mailer, {
      email: "device-adult@example.com",
      display_name: "Ada Device",
      dob: "1995-05-10",
    })

    const startRes = await app.request("/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "MacBook, terminal" }),
    })
    expect(startRes.status).toBe(200)
    const startBody = (await startRes.json()) as {
      device_code: string
      user_code: string
      verification_url: string
      interval: number
      expires_in: number
    }
    expect(startBody.device_code.length).toBeGreaterThanOrEqual(24)
    expect(startBody.user_code).toHaveLength(8)
    expect(startBody.user_code).not.toMatch(LOOK_ALIKE_CHARS)
    expect(startBody.expires_in).toBe(600)
    expect(startBody.interval).toBeGreaterThanOrEqual(5)
    expect(startBody.verification_url).toBe(`http://127.0.0.1:5173/device/verify?code=${startBody.user_code}`)

    // Legacy API /device/verify redirects to the React dashboard, and /device/verify/info returns JSON state.
    const verifyUrl = new URL(startBody.verification_url)
    const redirectRes = await app.request(`${verifyUrl.pathname}${verifyUrl.search}`)
    expect(redirectRes.status).toBe(302)
    expect(redirectRes.headers.get("location")).toBe(startBody.verification_url)

    const anonInfoRes = await app.request(`/device/verify/info?code=${startBody.user_code}`)
    expect(anonInfoRes.status).toBe(200)
    const anonInfo = (await anonInfoRes.json()) as { user_code: string; formatted_code: string; viewer: unknown }
    expect(anonInfo.user_code).toBe(startBody.user_code)
    expect(anonInfo.formatted_code).toBe(`${startBody.user_code.slice(0, 4)}-${startBody.user_code.slice(4)}`)
    expect(anonInfo.viewer).toBeNull()

    const signedInInfoRes = await app.request(`/device/verify/info?code=${startBody.user_code}`, {
      headers: { cookie },
    })
    expect(signedInInfoRes.status).toBe(200)
    const signedInInfo = (await signedInInfoRes.json()) as {
      viewer: { display_name: string; can_approve: boolean } | null
    }
    expect(signedInInfo.viewer?.display_name).toBe("Ada Device")
    expect(signedInInfo.viewer?.can_approve).toBe(true)

    const approveRes = await app.request("/device/approve", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ user_code: startBody.user_code }),
    })
    expect(approveRes.status).toBe(200)

    const tokenRes = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: startBody.device_code }),
    })
    expect(tokenRes.status).toBe(200)
    const tokenBody = (await tokenRes.json()) as {
      device_id: string
      device_name: string
      token_type: string
      device_token: string
      access_token: string
      refresh_token: string
      expires_in: number
    }
    expect(tokenBody.token_type).toBe("Bearer")
    expect(tokenBody.device_name).toBe("MacBook, terminal")
    expect(tokenBody.device_token).toBeTruthy()
    expect(tokenBody.access_token).toBe(tokenBody.device_token)
    expect(tokenBody.refresh_token).toBeTruthy()
    expect(tokenBody.expires_in).toBeGreaterThan(60 * 60 * 24)

    // Device token works on /me and /devices.
    const meRes = await app.request("/me", {
      headers: { authorization: `Bearer ${tokenBody.device_token}` },
    })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { email: string; display_name: string; status: string }
    expect(meBody.email).toBe("device-adult@example.com")
    expect(meBody.status).toBe("active")

    const listRes = await app.request("/devices", {
      headers: { authorization: `Bearer ${tokenBody.device_token}` },
    })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      devices: Array<{ id: string; name: string; token_hash?: string; refresh_token_hash?: string }>
    }
    expect(listBody.devices).toHaveLength(1)
    expect(listBody.devices[0]?.id).toBe(tokenBody.device_id)
    expect(listBody.devices[0]?.name).toBe("MacBook, terminal")
    expect(listBody.devices[0]?.token_hash).toBeUndefined()
    expect(listBody.devices[0]?.refresh_token_hash).toBeUndefined()

    // Tokens are stored as hashes, never plaintext.
    const [dbDevice] = await testDb.db.select().from(schema.devices).where(eq(schema.devices.id, tokenBody.device_id))
    expect(dbDevice).toBeDefined()
    expect(dbDevice!.token_hash).not.toBe(tokenBody.device_token)
    expect(dbDevice!.token_hash).toBe(hashToken(tokenBody.device_token))
    expect(dbDevice!.refresh_token_hash).not.toBe(tokenBody.refresh_token)
    expect(dbDevice!.refresh_token_hash).toBe(hashToken(tokenBody.refresh_token))
  })

  it("returns authorization_pending before approval, slow_down when polled too fast, and expired_token after 10 minutes", async () => {
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer: createFakeMailer(),
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now: () => currentTime,
    })

    const startRes = await app.request("/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Linux, terminal" }),
    })
    expect(startRes.status).toBe(200)
    const { device_code, interval } = (await startRes.json()) as { device_code: string; interval: number }

    // First poll before approval -> authorization_pending.
    const firstPoll = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    expect(firstPoll.status).toBe(400)
    expect(((await firstPoll.json()) as { error: string }).error).toBe("authorization_pending")

    // Poll again too fast -> slow_down.
    currentTime += 1000
    const fastPoll = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    expect(fastPoll.status).toBe(400)
    expect(((await fastPoll.json()) as { error: string }).error).toBe("slow_down")

    // Wait past interval -> authorization_pending again.
    currentTime += interval * 1000
    const allowedPoll = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    expect(allowedPoll.status).toBe(400)
    expect(((await allowedPoll.json()) as { error: string }).error).toBe("authorization_pending")

    // Advance fake clock past 10-minute expiry -> expired_token.
    currentTime += 10 * 60 * 1000 + 1000
    const expiredPoll = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    expect(expiredPoll.status).toBe(400)
    expect(((await expiredPoll.json()) as { error: string }).error).toBe("expired_token")
  })

  it("returns 401 on /me after a device token is revoked via DELETE /devices/:id", async () => {
    let currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now: () => currentTime,
    })

    const { cookie } = await createSignedInUser(app, mailer, {
      email: "revoke-adult@example.com",
      display_name: "Revoke User",
      dob: "1992-01-15",
    })

    const startRes = await app.request("/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Office Laptop, MCP" }),
    })
    const { device_code, user_code } = (await startRes.json()) as { device_code: string; user_code: string }

    await app.request("/device/approve", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ user_code }),
    })

    const tokenRes = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    const { device_id, device_token } = (await tokenRes.json()) as { device_id: string; device_token: string }

    const beforeRevoke = await app.request("/me", {
      headers: { authorization: `Bearer ${device_token}` },
    })
    expect(beforeRevoke.status).toBe(200)

    const revokeRes = await app.request(`/devices/${device_id}`, {
      method: "DELETE",
      headers: { cookie },
    })
    expect(revokeRes.status).toBe(200)
    expect(await revokeRes.json()).toEqual({ ok: true, revoked: true, id: device_id })

    const afterRevoke = await app.request("/me", {
      headers: { authorization: `Bearer ${device_token}` },
    })
    expect(afterRevoke.status).toBe(401)
  })

  it("blocks a pending_guardian teen from approving a device and explains why on the verification page", async () => {
    const currentTime = new Date("2026-11-25T10:00:00Z").getTime()
    const mailer = createFakeMailer()
    const app = createApp({
      version: "0.1.0",
      nodeEnv: "test",
      logger: createLogger({ level: "silent" }),
      db: testDb.db,
      mailer,
      authSecret: AUTH_SECRET,
      apiUrl: "http://127.0.0.1:3001",
      webUrl: "http://127.0.0.1:5173",
      now: () => currentTime,
    })

    const { cookie } = await createSignedInUser(app, mailer, {
      email: "device-teen@example.com",
      display_name: "Pending Teen",
      dob: "2010-06-15",
      guardian_email: "device-teen-parent@example.com",
    })

    const startRes = await app.request("/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Teen Chromebook, terminal" }),
    })
    expect(startRes.status).toBe(200)
    const { device_code, user_code } = (await startRes.json()) as {
      device_code: string
      user_code: string
      verification_url: string
    }

    const infoRes = await app.request(`/device/verify/info?code=${user_code}`, {
      headers: { cookie },
    })
    expect(infoRes.status).toBe(200)
    const info = (await infoRes.json()) as {
      viewer: { can_approve: boolean; blocked_reason: string | null } | null
    }
    expect(info.viewer?.can_approve).toBe(false)
    expect((info.viewer?.blocked_reason ?? "").toLowerCase()).toContain("guardian")

    const approveRes = await app.request("/device/approve", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ user_code }),
    })
    expect(approveRes.status).toBe(403)
    expect(((await approveRes.json()) as { error: { code: string } }).error.code).toBe("GUARDIAN_PENDING")

    // Token endpoint still reports authorization_pending.
    const tokenRes = await app.request("/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    })
    expect(tokenRes.status).toBe(400)
    expect(((await tokenRes.json()) as { error: string }).error).toBe("authorization_pending")
  })
})

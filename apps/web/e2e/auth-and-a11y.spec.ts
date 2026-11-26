import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 4301}`

interface CapturedEmail {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

async function fetchEmails(to: string): Promise<CapturedEmail[]> {
  const res = await fetch(`${API_URL}/__test/emails?to=${encodeURIComponent(to)}`)
  expect(res.ok).toBe(true)
  const data = (await res.json()) as { emails: CapturedEmail[] }
  return data.emails
}

function extractUrl(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  if (!match) {
    throw new Error(`Could not match ${pattern} in email text:\n${text}`)
  }
  return match[0]
}

async function assertNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  )
  expect(
    seriousOrCritical,
    seriousOrCritical.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.html).join(", ")}`).join("\n"),
  ).toEqual([])
}

test.describe("Pendix web dashboard auth, guardian, device approval, and accessibility", () => {
  test("adult sign-up, verify email, sign in, land on home, with no serious axe violations on sign-up, sign-in, and home", async ({
    page,
  }) => {
    const email = `adult-${Date.now()}@example.com`
    const password = "Password123!"

    await page.goto("/signup")
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible()
    await assertNoSeriousAxeViolations(page)

    await page.getByLabel("Display name").fill("Ada Adult")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(password)
    await page.getByLabel("Date of birth").fill("1995-05-10")
    await page.getByLabel(/i agree to the terms/i).check()

    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(/check your email/i)).toBeVisible()

    const emails = await fetchEmails(email)
    expect(emails.length).toBeGreaterThanOrEqual(1)
    const verifyUrl = new URL(extractUrl(emails[0]!.text, /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i))
    const token = verifyUrl.searchParams.get("token")
    expect(token).toBeTruthy()

    await page.goto(`/verify-email?token=${encodeURIComponent(token!)}`)
    await expect(page.getByText(/email verified/i)).toBeVisible()

    await page.goto("/signin")
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible()
    await assertNoSeriousAxeViolations(page)

    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: /^sign in$/i }).click()

    await page.waitForURL("**/")
    await expect(page.getByRole("heading", { name: /welcome back, ada adult/i })).toBeVisible()
    await assertNoSeriousAxeViolations(page)
  })

  test("teen sign-up shows guardian email field and guardian approval activates the teen account", async ({
    page,
  }) => {
    const teenEmail = `teen-${Date.now()}@example.com`
    const guardianEmail = `guardian-${Date.now()}@example.com`

    await page.goto("/signup")
    await page.getByLabel("Display name").fill("Tomi Teen")
    await page.getByLabel("Email").fill(teenEmail)
    await page.getByLabel("Password").fill("Password123!")

    // Guardian field appears once a 15-17 DOB is entered.
    await expect(page.getByLabel(/parent or guardian email/i)).toBeHidden()
    await page.getByLabel("Date of birth").fill("2010-06-15")
    await expect(page.getByLabel(/parent or guardian email/i)).toBeVisible()
    await page.getByLabel(/parent or guardian email/i).fill(guardianEmail)
    await page.getByLabel(/i agree to the terms/i).check()

    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByRole("heading", { name: /waiting for guardian approval/i })).toBeVisible()

    const guardianEmails = await fetchEmails(guardianEmail)
    expect(guardianEmails.length).toBeGreaterThanOrEqual(1)
    const approvalUrl = new URL(
      extractUrl(guardianEmails[0]!.text, /https?:\/\/[^\s"'<>]+\/guardian\/approval\/[^\s"'<>]+/i),
    )

    await page.goto(approvalUrl.pathname)
    await expect(page.getByText(/tomi teen/i)).toBeVisible()
    await page.getByRole("button", { name: /approve account/i }).click()
    await expect(page.getByText(/account approved/i)).toBeVisible()

    const checkRes = await fetch(`${API_URL}/__test/user-exists?email=${encodeURIComponent(teenEmail)}`)
    const check = (await checkRes.json()) as { exists: boolean; user: { status: string } | null }
    expect(check.exists).toBe(true)
    expect(check.user?.status).toBe("active")
  })

  test("under-15 sign-up shows a kind message and the API stores no record", async ({ page }) => {
    const childEmail = `under15-${Date.now()}@example.com`

    await page.goto("/signup")
    await page.getByLabel("Display name").fill("Young Learner")
    await page.getByLabel("Email").fill(childEmail)
    await page.getByLabel("Password").fill("Password123!")
    await page.getByLabel("Date of birth").fill("2015-05-10")

    await expect(page.getByText(/15 and older/i)).toBeVisible()
    await expect(page.getByText(/not saved/i)).toBeVisible()

    const checkRes = await fetch(`${API_URL}/__test/user-exists?email=${encodeURIComponent(childEmail)}`)
    const check = (await checkRes.json()) as { exists: boolean; count: number }
    expect(check.exists).toBe(false)
    expect(check.count).toBe(0)
  })

  test("device approval page approves a waiting terminal sign-in", async ({ page }) => {
    const email = `device-${Date.now()}@example.com`
    const password = "Password123!"

    // Create & verify an adult user via API, then sign in on the web page.
    const signupRes = await fetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        display_name: "Dev Terminal",
        dob: "1994-04-20",
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(signupRes.status).toBe(201)

    const emails = await fetchEmails(email)
    const verifyUrl = extractUrl(emails[0]!.text, /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i)
    await fetch(verifyUrl)

    // Start a waiting terminal device login.
    const startRes = await fetch(`${API_URL}/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "MacBook Pro, terminal" }),
    })
    expect(startRes.status).toBe(200)
    const started = (await startRes.json()) as {
      device_code: string
      user_code: string
      verification_url: string
    }
    const formattedCode = `${started.user_code.slice(0, 4)}-${started.user_code.slice(4)}`

    // Visit device approval URL while logged out -> sign in -> approve.
    const verifyTarget = new URL(started.verification_url)
    await page.goto(`${verifyTarget.pathname}${verifyTarget.search}`)
    await expect(page.getByText(formattedCode)).toBeVisible()

    // Sign in via link or inline redirect to /signin
    await page.getByRole("link", { name: /sign in/i }).click()
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: /^sign in$/i }).click()

    await page.waitForURL(`**/device/verify**`)
    await expect(
      page.getByText(/is this you signing in to pendix in your terminal/i),
    ).toBeVisible()
    await expect(page.getByText(formattedCode)).toBeVisible()

    await page.getByRole("button", { name: /approve/i }).click()
    await expect(page.getByText(/terminal connected|device approved/i)).toBeVisible()

    // Terminal polls /device/token and receives a valid device token!
    const tokenRes = await fetch(`${API_URL}/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: started.device_code }),
    })
    expect(tokenRes.status).toBe(200)
    const tokenBody = (await tokenRes.json()) as { device_token: string; device_name: string }
    expect(tokenBody.device_token).toBeTruthy()
    expect(tokenBody.device_name).toBe("MacBook Pro, terminal")
  })
})

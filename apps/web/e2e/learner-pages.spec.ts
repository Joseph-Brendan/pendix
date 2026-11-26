import { expect, test } from "@playwright/test"

const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 4301}`

interface CapturedEmail {
  readonly to: string
  readonly text: string
}

async function fetchEmails(to: string): Promise<CapturedEmail[]> {
  const res = await fetch(`${API_URL}/__test/emails?to=${encodeURIComponent(to)}`)
  expect(res.ok).toBe(true)
  const data = (await res.json()) as { emails: CapturedEmail[] }
  return data.emails
}

function extractUrl(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  if (!match) throw new Error(`URL not found in email: ${text}`)
  return match[0]
}

async function createAndSignInAdult(page: import("@playwright/test").Page, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`
  const password = "Password123!"

  const signupRes = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      display_name: `${prefix} Learner`,
      dob: "1995-04-12",
      terms_version: "2026-01",
      privacy_version: "2026-01",
      tz: "UTC",
    }),
  })
  expect(signupRes.status).toBe(201)
  const { user } = (await signupRes.json()) as { user: { id: string } }

  const emails = await fetchEmails(email)
  const verifyUrl = extractUrl(emails[0]!.text, /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i)
  await fetch(verifyUrl)

  await page.goto("/signin")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /^sign in$/i }).click()
  await page.waitForURL("**/")

  return { userId: user.id, email, password }
}

test.describe("learner dashboard pages", () => {
  test("a learner with 3 graded sessions opens one, sees all scores and improved prompts, and copies an improved prompt", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const { userId } = await createAndSignInAdult(page, "sessions")

    const seedRes = await fetch(`${API_URL}/__test/seed-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, count: 3 }),
    })
    expect(seedRes.status).toBe(201)
    const seeded = (await seedRes.json()) as { session_ids: string[] }
    expect(seeded.session_ids).toHaveLength(3)

    // Home shows recent sessions and scores.
    await page.goto("/")
    await expect(page.getByText(/8-week trend/i)).toBeVisible()
    await expect(page.getByText("Project Alpha 1")).toBeVisible()

    // Navigate to Sessions list and open one session.
    await page.getByRole("link", { name: "Sessions" }).first().click()
    await page.waitForURL("**/sessions")
    await expect(page.getByText("Project Alpha 1")).toBeVisible()
    await expect(page.getByText("Project Alpha 2")).toBeVisible()
    await expect(page.getByText("Project Alpha 3")).toBeVisible()

    await page.getByRole("link", { name: "Project Alpha 1" }).click()
    await page.waitForURL(`**/sessions/${seeded.session_ids[0]}`)

    // Session detail shows 5 criterion scores, reasons, understanding score, notes, model, and improved prompt.
    await expect(page.getByRole("heading", { name: "Project Alpha 1" })).toBeVisible()
    await expect(page.getByText(/understanding/i).first()).toBeVisible()
    await expect(page.getByText(/goal/i).first()).toBeVisible()
    await expect(page.getByText(/context/i).first()).toBeVisible()
    await expect(page.getByText(/constraints/i).first()).toBeVisible()
    await expect(page.getByText(/verification/i).first()).toBeVisible()
    await expect(page.getByText(/steps/i).first()).toBeVisible()
    await expect(page.getByText(/google\/gemini/i).first()).toBeVisible()

    const copyBtn = page.getByRole("button", { name: /copy improved prompt/i }).first()
    await copyBtn.click()
    await expect(page.getByText(/copied/i).first()).toBeVisible()
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain("Update src/feature-1.ts")

    // "This grade feels wrong" button works per prompt.
    await page.getByRole("button", { name: /this grade feels wrong/i }).first().click()
    await expect(page.getByText(/flagged for review/i).first()).toBeVisible()
  })

  test("answering an assessment shows results", async ({ page }) => {
    const { userId } = await createAndSignInAdult(page, "assess")

    const seedRes = await fetch(`${API_URL}/__test/seed-assessment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, subscriber: true }),
    })
    expect(seedRes.status).toBe(201)
    const { assessment_id } = (await seedRes.json()) as { assessment_id: string }

    await page.goto("/assessments")
    await expect(page.getByRole("heading", { name: /assessments/i })).toBeVisible()
    await page.getByRole("link", { name: /open check|start check|view check/i }).first().click()
    await page.waitForURL(`**/assessments/${assessment_id}`)

    // Answer the 4 open questions and 1 multiple choice question.
    const textareas = page.locator("textarea")
    await expect(textareas).toHaveCount(4)
    for (let i = 0; i < 4; i += 1) {
      await textareas
        .nth(i)
        .fill("The change validates server inputs and prevents bad state from reaching the database.")
    }

    await page.getByRole("radio").first().check()
    await page.getByRole("button", { name: /submit answers/i }).click()

    await expect(page.getByRole("heading", { name: /weekly check results/i })).toBeVisible()
    await expect(page.getByText(/\d+ \/ 10/)).toBeVisible()
    await expect(page.getByText(/clear and grounded answer/i).first()).toBeVisible()
  })

  test("buying credits through the fake checkout updates the balance", async ({ page }) => {
    await createAndSignInAdult(page, "billing")

    await page.goto("/billing")
    await expect(page.getByRole("heading", { name: /credits and billing/i })).toBeVisible()
    await expect(page.getByTestId("credit-balance")).toHaveText("0")

    await page.getByRole("button", { name: /buy 10 credits/i }).click()
    await page.waitForURL("**/billing?status=paid**")

    await expect(page.getByTestId("credit-balance")).toHaveText("10")
    await expect(page.getByText(/\+10/)).toBeVisible()
  })

  test("turning on self teach lock changes /me teach_lock", async ({ page }) => {
    await createAndSignInAdult(page, "teachlock")

    await page.goto("/settings")
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible()

    const toggle = page.getByLabel(/lock teach mode on/i)
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await page.getByRole("button", { name: /save settings/i }).click()
    await expect(page.getByText("Settings saved.", { exact: true })).toBeVisible()

    const me = await page.evaluate(async (apiUrl) => {
      const res = await fetch(`${apiUrl}/me`, { credentials: "include" })
      return (await res.json()) as { teach_lock: string }
    }, API_URL)
    expect(me.teach_lock).toBe("self")
  })

  test("teen sees 'Your guardian manages payments' and no purchase buttons", async ({ page }) => {
    const teenEmail = `teen-dash-${Date.now()}@example.com`
    const guardianEmail = `guard-dash-${Date.now()}@example.com`
    const password = "Password123!"

    const signupRes = await fetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: teenEmail,
        password,
        display_name: "Tomi Teen",
        dob: "2010-06-15",
        guardian_email: guardianEmail,
        terms_version: "2026-01",
        privacy_version: "2026-01",
      }),
    })
    expect(signupRes.status).toBe(201)

    // Verify teen email AND approve via guardian link.
    const teenEmails = await fetchEmails(teenEmail)
    await fetch(extractUrl(teenEmails[0]!.text, /https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/i))

    const guardianEmails = await fetchEmails(guardianEmail)
    const approvalUrl = new URL(
      extractUrl(guardianEmails[0]!.text, /https?:\/\/[^\s"'<>]+\/guardian\/approval\/[^\s"'<>]+/i),
    )
    const token = approvalUrl.pathname.split("/").pop()!
    const approveRes = await fetch(`${API_URL}/guardian/approval/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", consent_version: "2026-01" }),
    })
    expect(approveRes.status).toBe(200)

    await page.goto("/signin")
    await page.getByLabel("Email").fill(teenEmail)
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: /^sign in$/i }).click()
    await page.waitForURL("**/")

    await expect(page.getByText(/your guardian manages payments/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /buy|subscribe|upgrade/i })).toHaveCount(0)

    await page.goto("/billing")
    await expect(page.getByText(/your guardian manages payments/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /buy|subscribe|upgrade/i })).toHaveCount(0)
  })

  test("revoking a device logs that device out", async ({ page }) => {
    await createAndSignInAdult(page, "revoke-dev")

    // Connect a terminal device for this user.
    const startRes = await fetch(`${API_URL}/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Work MacBook Terminal" }),
    })
    const started = (await startRes.json()) as { device_code: string; user_code: string }

    // Approve via browser session cookies.
    const approved = await page.evaluate(
      async ({ apiUrl, userCode }) => {
        const res = await fetch(`${apiUrl}/device/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ user_code: userCode }),
        })
        return res.status
      },
      { apiUrl: API_URL, userCode: started.user_code },
    )
    expect(approved).toBe(200)

    const tokenRes = await fetch(`${API_URL}/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: started.device_code }),
    })
    const { device_token } = (await tokenRes.json()) as { device_token: string }

    // Device token works before revoke.
    const beforeMe = await fetch(`${API_URL}/me`, {
      headers: { authorization: `Bearer ${device_token}` },
    })
    expect(beforeMe.status).toBe(200)

    // Revoke the device from Settings page.
    await page.goto("/settings")
    await expect(page.getByText("Work MacBook Terminal")).toBeVisible()
    await page.getByRole("button", { name: /revoke/i }).first().click()
    await expect(page.getByText("Work MacBook Terminal")).toBeHidden()

    // Device token is now logged out (401).
    const afterMe = await fetch(`${API_URL}/me`, {
      headers: { authorization: `Bearer ${device_token}` },
    })
    expect(afterMe.status).toBe(401)
  })
})

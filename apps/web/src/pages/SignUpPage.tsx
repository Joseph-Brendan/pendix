import { accountKindFor } from "@pendix/shared/age"
import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState, type FormEvent } from "react"
import { AuthShell } from "../components/AuthShell.js"
import { ApiClientError, apiFetch } from "../lib/api.js"
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "../ui/index.js"

interface SignupResponse {
  readonly user: {
    readonly id: string
    readonly email: string
    readonly display_name: string
    readonly account_kind: "adult" | "teen"
    readonly status: string
  }
}

export function SignUpPage() {
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [dob, setDob] = useState("")
  const [guardianEmail, setGuardianEmail] = useState("")
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [createdUser, setCreatedUser] = useState<SignupResponse["user"] | null>(null)

  const ageKind = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
    try {
      return accountKindFor(dob)
    } catch {
      return null
    }
  }, [dob])

  const isUnder15 = ageKind === "blocked"
  const isTeen = ageKind === "teen"

  const signupMutation = useMutation({
    mutationFn: async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      return apiFetch<SignupResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim(),
          password,
          dob,
          ...(isTeen ? { guardian_email: guardianEmail.trim() } : {}),
          terms_version: "2026-01",
          privacy_version: "2026-01",
          tz,
        }),
      })
    },
    onSuccess: (data) => {
      setFormError(null)
      setCreatedUser(data.user)
    },
    onError: (err) => {
      setFormError(err instanceof ApiClientError ? err.message : "Could not create your account.")
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    // SPEC S5/S6: Under-15 accounts are never sent to or stored by the API.
    if (isUnder15) {
      return
    }
    if (!displayName.trim()) {
      setFormError("Enter a display name.")
      return
    }
    if (!email.trim() || !email.includes("@")) {
      setFormError("Enter a valid email address.")
      return
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setFormError("Enter your date of birth.")
      return
    }
    if (!agreedTerms) {
      setFormError("Please agree to the Terms and Privacy Policy to continue.")
      return
    }
    if (isTeen && !guardianEmail.trim()) {
      setFormError("Enter a parent or guardian email address.")
      return
    }

    signupMutation.mutate()
  }

  if (createdUser) {
    const teenPending = createdUser.account_kind === "teen"
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {teenPending ? "Waiting for guardian approval" : "Check your email"}
            </h1>
            <CardDescription>
              {teenPending
                ? "We sent an approval link to your parent or guardian. Your account will be ready once they approve it."
                : `We sent a verification link to ${createdUser.email}. Open it to activate your account.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link
              to="/signin"
              search={{ redirect: undefined }}
              className="inline-flex h-10 items-center justify-center rounded-pendix bg-ink px-4 text-sm font-medium text-white hover:bg-off-black"
            >
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Create your account</h1>
          <CardDescription>Start building with Pendix and track your prompting skills.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Display name"
              name="display_name"
              autoComplete="name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              hint="Use at least 8 characters."
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="Date of birth"
              name="dob"
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />

            {isUnder15 ? (
              <div
                role="status"
                className="rounded-pendix border border-line bg-off-white p-4 text-sm text-ink"
              >
                <p className="font-medium">Pendix is for learners aged 15 and older.</p>
                <p className="mt-1 text-muted">
                  We have not saved your details. We would love to welcome you when you turn 15.
                </p>
              </div>
            ) : null}

            {isTeen ? (
              <Input
                label="Parent or guardian email"
                name="guardian_email"
                type="email"
                autoComplete="off"
                hint="For ages 15 to 17, a parent or guardian must approve your account first."
                required
                value={guardianEmail}
                onChange={(e) => setGuardianEmail(e.target.value)}
              />
            ) : null}

            {!isUnder15 ? (
              <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line accent-ink"
                />
                <span>I agree to the Terms of Service and Privacy Policy.</span>
              </label>
            ) : null}

            {formError ? (
              <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                {formError}
              </div>
            ) : null}

            {!isUnder15 ? (
              <Button type="submit" variant="accent" size="lg" disabled={signupMutation.isPending}>
                {signupMutation.isPending ? "Creating account..." : "Create account"}
              </Button>
            ) : null}
          </form>

          <p className="mt-5 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link to="/signin" search={{ redirect: undefined }} className="font-medium text-ink underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

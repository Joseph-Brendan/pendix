import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { AuthShell } from "../components/AuthShell.js"
import { apiFetch } from "../lib/api.js"
import { Button, Card, CardContent, CardDescription, CardHeader, Input } from "../ui/index.js"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    onSuccess: () => {
      setSent(true)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    resetMutation.mutate()
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Reset your password</h1>
          <CardDescription>
            {sent
              ? "If an account exists for that email, we sent a password reset link."
              : "Enter your account email and we will send a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <Link
              to="/signin"
              search={{ redirect: undefined }}
              className="inline-flex h-10 w-full items-center justify-center rounded-pendix bg-ink px-4 text-sm font-medium text-white hover:bg-off-black"
            >
              Back to sign in
            </Link>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" variant="accent" size="lg" disabled={resetMutation.isPending}>
                {resetMutation.isPending ? "Sending link..." : "Send reset link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { AuthShell } from "../components/AuthShell.js"
import { ApiClientError, apiFetch } from "../lib/api.js"
import { Button, Card, CardContent, CardDescription, CardHeader, Input } from "../ui/index.js"

export function SignInPage() {
  const search = useSearch({ from: "/signin" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const signInMutation = useMutation({
    mutationFn: () =>
      apiFetch("/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      }),
    onSuccess: async () => {
      setFormError(null)
      await queryClient.invalidateQueries()
      const redirect = typeof search.redirect === "string" && search.redirect.startsWith("/") ? search.redirect : "/"
      await navigate({ href: redirect })
    },
    onError: (err) => {
      setFormError(err instanceof ApiClientError ? err.message : "Invalid email or password.")
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    signInMutation.mutate()
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
          <CardDescription>Welcome back to Pendix.</CardDescription>
        </CardHeader>
        <CardContent>
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
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs font-medium text-muted hover:text-ink underline underline-offset-4">
                Forgot password?
              </Link>
            </div>

            {formError ? (
              <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                {formError}
              </div>
            ) : null}

            <Button type="submit" variant="accent" size="lg" disabled={signInMutation.isPending}>
              {signInMutation.isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted">
            New to Pendix?{" "}
            <Link to="/signup" className="font-medium text-ink underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

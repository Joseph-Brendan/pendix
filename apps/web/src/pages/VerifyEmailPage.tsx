import { useQuery } from "@tanstack/react-query"
import { Link, useSearch } from "@tanstack/react-router"
import { AuthShell } from "../components/AuthShell.js"
import { API_URL } from "../lib/api.js"
import { Card, CardContent, CardDescription, CardHeader, Skeleton } from "../ui/index.js"

export function VerifyEmailPage() {
  const search = useSearch({ from: "/verify-email" })
  const token = typeof search.token === "string" ? search.token : ""
  const alreadyVerified = search.verified === "1"

  const verifyQuery = useQuery({
    queryKey: ["verify-email", token],
    enabled: Boolean(token) && !alreadyVerified,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        method: "GET",
        credentials: "include",
      })
      if (!res.ok) {
        throw new Error("This verification link is invalid or has expired.")
      }
      return { verified: true }
    },
  })

  const isVerified = alreadyVerified || verifyQuery.isSuccess

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {isVerified
              ? "Email verified"
              : !token
                ? "Check your email"
                : verifyQuery.isLoading
                  ? "Verifying your email"
                  : "Verification link expired"}
          </h1>
          <CardDescription>
            {isVerified
              ? "Your email is confirmed. You can sign in now."
              : !token
                ? "Open the link we sent to your inbox to activate your Pendix account."
                : verifyQuery.isLoading
                  ? "Just a moment while we confirm your link."
                  : "That link did not work. Try signing up again or request a fresh link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {verifyQuery.isLoading ? <Skeleton className="h-10 w-full" /> : null}
          {!verifyQuery.isLoading ? (
            <Link
              to="/signin"
              search={{ redirect: undefined }}
              className="inline-flex h-10 items-center justify-center rounded-pendix bg-ink px-4 text-sm font-medium text-white hover:bg-off-black"
            >
              Sign in
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, type MeResponse } from "../lib/api.js"
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton } from "../ui/index.js"

export function HomePage() {
  const navigate = useNavigate()
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </main>
    )
  }

  if (!meQuery.data) {
    return null
  }

  const user = meQuery.data

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Welcome back, {user.display_name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Track your sessions, prompt scores, and weekly checks in one place.
            </p>
          </div>
          <Badge variant="score">Plan: {user.plan}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Current plan</CardDescription>
              <CardTitle className="capitalize">{user.plan}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">Account status: {user.status}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Credits</CardDescription>
              <CardTitle>{user.credits}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">1 credit grades a session. 2 credits open a weekly check.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Terminal sign-in</CardDescription>
              <CardTitle>Ready</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">
                Run <code className="rounded bg-off-white px-1.5 py-0.5 text-ink">pendix login</code> to connect your terminal.
              </p>
            </CardContent>
          </Card>
        </div>

        <EmptyState
          title="No graded sessions yet"
          description="Start a coding session in your terminal with Pendix. Your prompt scores, understanding notes, and weekly checks will show up here."
        />
      </div>
    </AppShell>
  )
}

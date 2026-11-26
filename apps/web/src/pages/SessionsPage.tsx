import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, type MeResponse, type SessionSummary } from "../lib/api.js"
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/index.js"

export function SessionsPage() {
  const navigate = useNavigate()
  const [searchText, setSearchText] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiFetch<{ sessions: readonly SessionSummary[] }>("/sessions"),
    enabled: Boolean(meQuery.data),
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  const filtered = useMemo(() => {
    const list = sessionsQuery.data?.sessions ?? []
    const needle = searchText.trim().toLowerCase()
    return list.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (!needle) return true
      return (
        (s.project_title || "").toLowerCase().includes(needle) ||
        (s.model || "").toLowerCase().includes(needle)
      )
    })
  }, [sessionsQuery.data, searchText, statusFilter])

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-40 max-w-5xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const user = meQuery.data

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Sessions</h1>
          <p className="mt-1 text-sm text-muted">
            Review every graded session, prompt score, and understanding summary.
          </p>
        </div>

        {user.plan === "free" && user.credits === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Session grading is a paid add-on</CardTitle>
              <CardDescription>
                {user.account_kind === "teen"
                  ? "Your guardian manages payments. Ask them to add credits or a plan to grade sessions."
                  : "Buy credits or subscribe to grade sessions and see improved prompts."}
              </CardDescription>
            </CardHeader>
            {user.account_kind !== "teen" ? (
              <CardContent>
                <Link
                  to="/billing"
                  search={{ status: undefined, tx_ref: undefined }}
                  className="inline-flex h-10 items-center justify-center rounded-pendix bg-hot-orange px-4 text-sm font-semibold text-ink hover:opacity-95"
                >
                  View credits and plans
                </Link>
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <Input
              label="Filter by project or model"
              placeholder="Search project or model..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <Select
              label="Status"
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "all", label: "All statuses" },
                { value: "graded", label: "Graded" },
                { value: "queued", label: "Queued" },
                { value: "failed", label: "Failed" },
              ]}
            />
          </CardContent>
        </Card>

        {sessionsQuery.isLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No sessions match your filter"
            description="Start a session in Pendix or clear your filters to see older sessions."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Prompt score</TableHead>
                <TableHead>Understanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted">
                    {session.created_at.slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: session.id }}
                      className="font-medium text-ink underline underline-offset-4"
                    >
                      {session.project_title || "Untitled session"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-muted">{session.model || "n/a"}</code>
                  </TableCell>
                  <TableCell>
                    {session.score !== null ? <Badge variant="score">{session.score}/10</Badge> : "n/a"}
                  </TableCell>
                  <TableCell>
                    {session.understanding_score !== null ? (
                      <Badge variant="neutral">{session.understanding_score}/10</Badge>
                    ) : (
                      "n/a"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{session.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AppShell>
  )
}

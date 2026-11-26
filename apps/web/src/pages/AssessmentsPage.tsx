import { CREDIT_COSTS } from "@pendix/shared/plans"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, type AssessmentSummary, type MeResponse } from "../lib/api.js"
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/index.js"

export function AssessmentsPage() {
  const navigate = useNavigate()

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const listQuery = useQuery({
    queryKey: ["assessments"],
    queryFn: () => apiFetch<{ assessments: readonly AssessmentSummary[] }>("/assessments"),
    enabled: Boolean(meQuery.data),
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-40 max-w-5xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const user = meQuery.data
  const assessments = listQuery.data?.assessments ?? []

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Assessments</h1>
          <p className="mt-1 text-sm text-muted">
            Five weekly questions from your own code, ready every Saturday at 09:00 your time.
          </p>
        </div>

        {user.plan === "free" && user.credits < CREDIT_COSTS.assessment ? (
          <Card>
            <CardHeader>
              <CardTitle>Weekly checks use {CREDIT_COSTS.assessment} credits or a subscription</CardTitle>
              <CardDescription>
                {user.account_kind === "teen"
                  ? "Your guardian manages payments. Ask them to add credits or a plan."
                  : "Complete 2 graded sessions in a week to unlock a weekly check. Subscribers get checks at no extra charge."}
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

        {listQuery.isLoading ? (
          <Skeleton className="h-44 w-full" />
        ) : assessments.length === 0 ? (
          <EmptyState
            title="No assessments yet"
            description="Complete at least 2 graded sessions in a week and your first weekly check will appear on Saturday morning."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-ink">
                    {item.week_key ?? item.created_at.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-xs text-muted">{item.due_at.slice(0, 10)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="neutral">{item.status}</Badge>
                      {item.is_late ? <Badge variant="neutral">late</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.total_score !== null ? <Badge variant="score">{item.total_score}/10</Badge> : "Pending"}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/assessments/$assessmentId"
                      params={{ assessmentId: item.id }}
                      className="text-sm font-medium text-ink underline underline-offset-4"
                    >
                      {item.status === "graded"
                        ? "View results"
                        : item.status === "opened"
                          ? "Continue check"
                          : "Open check"}
                    </Link>
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

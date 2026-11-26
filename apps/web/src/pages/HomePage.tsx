import { CREDIT_COSTS, CREDIT_PACKS, PLANS } from "@pendix/shared/plans"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, formatMoney, type DashboardResponse, type MeResponse, type ProfileResponse } from "../lib/api.js"
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "../ui/index.js"

function formatShortDate(iso: string): string {
  return iso.slice(0, 10)
}

export function HomePage() {
  const navigate = useNavigate()
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardResponse>("/me/dashboard"),
    enabled: Boolean(meQuery.data),
  })

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<ProfileResponse>("/me/profile"),
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
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-8 w-52" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-48" />
        </div>
      </main>
    )
  }

  if (!meQuery.data) {
    return null
  }

  const user = meQuery.data
  const dash = dashboardQuery.data
  const profile = profileQuery.data
  const isTeen = user.account_kind === "teen"
  const isFree = user.plan === "free"

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Welcome back, {user.display_name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Track your prompting skill, understanding, and weekly checks.
            </p>
          </div>
          {dash?.this_week.prompt_score !== null && dash?.this_week.prompt_score !== undefined ? (
            <Badge variant="score">This week: {dash.this_week.prompt_score}/10</Badge>
          ) : (
            <Badge variant="neutral">Plan: {user.plan}</Badge>
          )}
        </div>

        {/* Plan, Credits, and This Week summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Plan</CardDescription>
              <CardTitle className="capitalize">{user.plan}</CardTitle>
            </CardHeader>
            <CardContent>
              {isTeen ? (
                <p className="text-xs text-muted">Your guardian manages payments.</p>
              ) : isFree ? (
                <p className="text-xs text-muted">
                  Free includes teach mode and your own model keys.{" "}
                  <Link to="/billing" search={{ status: undefined, tx_ref: undefined }} className="font-medium text-ink underline underline-offset-4">
                    Upgrade or add credits
                  </Link>
                </p>
              ) : (
                <p className="text-xs text-muted">
                  {profile?.fair_use_remaining ?? 100} graded sessions left this month.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Credits</CardDescription>
              <CardTitle>{user.credits}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">
                {CREDIT_COSTS.sessionGrade} credit per session. {CREDIT_COSTS.assessment} credits per weekly check.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Prompt score (this week)</CardDescription>
              <CardTitle>
                {dash?.this_week.prompt_score !== null && dash?.this_week.prompt_score !== undefined
                  ? `${dash.this_week.prompt_score}/10`
                  : "No data"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">
                {dash?.this_week.graded_sessions ?? 0} graded session{dash?.this_week.graded_sessions === 1 ? "" : "s"} this week.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Understanding (this week)</CardDescription>
              <CardTitle>
                {dash?.this_week.understanding_score !== null && dash?.this_week.understanding_score !== undefined
                  ? `${dash.this_week.understanding_score}/10`
                  : "No data"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted">Tracked separately from prompt score.</p>
            </CardContent>
          </Card>
        </div>

        {/* Free user honest prompt (adults only; teens see guardian notice) */}
        {isFree && user.credits === 0 && !isTeen ? (
          <Card>
            <CardHeader>
              <CardTitle>Unlock session grading and weekly checks</CardTitle>
              <CardDescription>
                Your Free plan already includes Pendix with your own keys and teach mode. To grade sessions and get
                weekly checks, buy a pack of {CREDIT_PACKS.pack_3.credits} credits for{" "}
                {formatMoney(CREDIT_PACKS.pack_3.priceCents)} or start {PLANS.solo.name} at{" "}
                {formatMoney(PLANS.solo.prices.monthly)}/month.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/billing"
                search={{ status: undefined, tx_ref: undefined }}
                className="inline-flex h-10 items-center justify-center rounded-pendix bg-hot-orange px-4 text-sm font-semibold text-ink hover:opacity-95"
              >
                See credits and plans
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {/* Assessment due + Mentor card row */}
        {dash?.assessment_due || profile?.has_mentor || dash?.mentor ? (
          <div className="grid gap-4 md:grid-cols-2">
            {dash?.assessment_due ? (
              <Card>
                <CardHeader>
                  <CardDescription>Weekly check due</CardDescription>
                  <CardTitle>Your weekly check is ready</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm text-muted">
                    Due by {formatShortDate(dash.assessment_due.due_at)}. Five short questions from your own code.
                  </p>
                  <div>
                    <Link
                      to="/assessments/$assessmentId"
                      params={{ assessmentId: dash.assessment_due.id }}
                      className="inline-flex h-10 items-center justify-center rounded-pendix bg-hot-orange px-4 text-sm font-semibold text-ink hover:opacity-95"
                    >
                      Open weekly check
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {profile?.has_mentor || dash?.mentor ? (
              <Card>
                <CardHeader>
                  <CardDescription>Human mentor</CardDescription>
                  <CardTitle>{dash?.mentor ? dash.mentor.display_name : "Mentor matching in progress"}</CardTitle>
                </CardHeader>
                <CardContent>
                  {dash?.mentor ? (
                    <p className="text-sm text-muted">
                      Time zone: {dash.mentor.tz}. Matched on {formatShortDate(dash.mentor.matched_at)}.
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      Your Mentored plan includes weekly prompt reviews from a human mentor.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {/* 8-week trend */}
        <Card>
          <CardHeader>
            <CardTitle>8-week trend</CardTitle>
            <CardDescription>Weekly average prompt score and understanding score (out of 10).</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardQuery.isLoading ? (
              <Skeleton className="h-36 w-full" />
            ) : (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                {(dash?.trend ?? []).map((week) => {
                  const pHeight = week.prompt_score !== null ? Math.max(8, Math.round((week.prompt_score / 10) * 80)) : 4
                  const uHeight =
                    week.understanding_score !== null ? Math.max(8, Math.round((week.understanding_score / 10) * 80)) : 4
                  return (
                    <div key={week.week_start} className="flex flex-col items-center gap-1.5">
                      <div className="flex h-24 items-end gap-1.5" aria-label={`Week of ${week.week_start}`}>
                        <div
                          title={`Prompt score: ${week.prompt_score ?? "none"}`}
                          style={{ height: `${pHeight}px` }}
                          className={`w-3 rounded-t ${week.prompt_score !== null ? "bg-ink" : "bg-line"}`}
                        />
                        <div
                          title={`Understanding: ${week.understanding_score ?? "none"}`}
                          style={{ height: `${uHeight}px` }}
                          className={`w-3 rounded-t ${week.understanding_score !== null ? "bg-muted" : "bg-line/70"}`}
                        />
                      </div>
                      <span className="text-[11px] text-muted">{week.week_start.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-ink" />
                Prompt score
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-muted" />
                Understanding score
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Last 5 sessions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Recent sessions</CardTitle>
              <CardDescription>Your last 5 coding sessions.</CardDescription>
            </div>
            <Link to="/sessions" className="text-sm font-medium text-ink underline underline-offset-4">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {dashboardQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !dash?.recent_sessions.length ? (
              <EmptyState
                title="No sessions yet"
                description="Run pendix in your terminal to record and grade your coding sessions."
              />
            ) : (
              <ul className="divide-y divide-line">
                {dash.recent_sessions.map((session) => (
                  <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        to="/sessions/$sessionId"
                        params={{ sessionId: session.id }}
                        className="text-sm font-medium text-ink hover:underline underline-offset-4"
                      >
                        {session.project_title || "Untitled session"}
                      </Link>
                      <span className="text-xs text-muted">
                        {formatShortDate(session.created_at)} · <code className="text-xs">{session.model || "unknown model"}</code>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.score !== null ? <Badge variant="score">Prompt {session.score}/10</Badge> : null}
                      {session.understanding_score !== null ? (
                        <Badge variant="neutral">Understanding {session.understanding_score}/10</Badge>
                      ) : null}
                      <Badge variant="neutral">{session.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

import { CREDIT_COSTS, CREDIT_PACKS, PLANS, priceFor, type BillingPeriod, type PaidPlanId } from "@pendix/shared/plans"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AppShell } from "../components/AppShell.js"
import {
  ApiClientError,
  apiFetch,
  formatMoney,
  type BillingSummaryResponse,
  type CreditsHistoryResponse,
  type MeResponse,
} from "../lib/api.js"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "../ui/index.js"

export function BillingPage() {
  const search = useSearch({ from: "/billing" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [period, setPeriod] = useState<BillingPeriod>("monthly")
  const [actionError, setActionError] = useState<string | null>(null)

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const creditsQuery = useQuery({
    queryKey: ["credits"],
    queryFn: () => apiFetch<CreditsHistoryResponse>("/me/credits"),
    enabled: Boolean(meQuery.data),
  })

  const summaryQuery = useQuery({
    queryKey: ["billing-summary"],
    queryFn: () => apiFetch<BillingSummaryResponse>("/billing/summary"),
    enabled: Boolean(meQuery.data),
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  const buyCreditsMutation = useMutation({
    mutationFn: (pack: "3" | "10") =>
      apiFetch<{ link: string }>("/billing/credits/checkout", {
        method: "POST",
        body: JSON.stringify({ pack }),
      }),
    onSuccess: (res) => {
      setActionError(null)
      window.location.assign(res.link)
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not start checkout.")
    },
  })

  const subscribeMutation = useMutation({
    mutationFn: (input: { readonly plan: PaidPlanId; readonly period: BillingPeriod }) =>
      apiFetch<{ link: string }>("/billing/subscribe", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      setActionError(null)
      window.location.assign(res.link)
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not start subscription checkout.")
    },
  })

  const upgradeMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ link: string }>("/billing/upgrade", {
        method: "POST",
        body: JSON.stringify({ to_plan: "mentored" }),
      }),
    onSuccess: (res) => {
      setActionError(null)
      window.location.assign(res.link)
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not start upgrade.")
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch("/billing/cancel", { method: "POST" }),
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: ["billing-summary"] })
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      showToast({
        title: "Subscription cancelled",
        description: "You will keep access until the end of your current billing period.",
      })
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not cancel subscription.")
    },
  })

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-48 max-w-5xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const user = meQuery.data
  const isTeen = user.account_kind === "teen"
  const credits = creditsQuery.data
  const summary = summaryQuery.data

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Credits and billing</h1>
          <p className="mt-1 text-sm text-muted">
            Manage your credit balance, subscription, and payment receipts.
          </p>
        </div>

        {search.status === "paid" ? (
          <div role="status" className="rounded-pendix border border-line bg-white px-4 py-3 text-sm text-ink">
            Payment confirmed. Your balance and plan have been updated.
          </div>
        ) : null}

        {actionError ? (
          <div role="alert" className="rounded-pendix border border-ink bg-white px-4 py-3 text-sm text-ink">
            {actionError}
          </div>
        ) : null}

        {/* SPEC S6 rule 2: Teens see no purchase buttons and clear guardian notice. */}
        {isTeen ? (
          <Card>
            <CardHeader>
              <CardTitle>Your guardian manages payments</CardTitle>
              <CardDescription>
                For accounts aged 15 to 17, a parent or guardian handles credit packs and paid plans from their own
                guardian view.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted">Current plan: </span>
                <strong className="capitalize text-ink">{user.plan}</strong>
              </div>
              <div>
                <span className="text-muted">Credits: </span>
                <strong data-testid="credit-balance" className="text-ink">
                  {credits?.balance ?? user.credits}
                </strong>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardDescription>Credit balance</CardDescription>
                  <CardTitle data-testid="credit-balance">{credits?.balance ?? user.credits}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-xs text-muted">
                    {CREDIT_COSTS.sessionGrade} credit grades a session. {CREDIT_COSTS.assessment} credits open a weekly
                    check.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => buyCreditsMutation.mutate("3")}
                      disabled={buyCreditsMutation.isPending}
                    >
                      Buy {CREDIT_PACKS.pack_3.credits} credits ({formatMoney(CREDIT_PACKS.pack_3.priceCents)})
                    </Button>
                    <Button
                      variant="accent"
                      onClick={() => buyCreditsMutation.mutate("10")}
                      disabled={buyCreditsMutation.isPending}
                    >
                      Buy {CREDIT_PACKS.pack_10.credits} credits ({formatMoney(CREDIT_PACKS.pack_10.priceCents)})
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardDescription>Current plan</CardDescription>
                  <CardTitle className="capitalize">{user.plan}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {summary?.subscription ? (
                    <>
                      <p className="text-xs text-muted">
                        Period: {summary.subscription.period} · Ends{" "}
                        {summary.subscription.current_period_end.slice(0, 10)}
                        {summary.subscription.cancel_at_period_end ? " (cancels at period end)" : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {user.plan === "solo" && !summary.subscription.cancel_at_period_end ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => upgradeMutation.mutate()}
                            disabled={upgradeMutation.isPending}
                          >
                            Upgrade to Mentored
                          </Button>
                        ) : null}
                        {summary.subscription.status === "active" && !summary.subscription.cancel_at_period_end ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => cancelMutation.mutate()}
                            disabled={cancelMutation.isPending}
                          >
                            Cancel plan
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted">
                      No active subscription. Subscribe below for up to 100 graded sessions a month and included weekly
                      checks.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
                <div>
                  <CardTitle>Plans</CardTitle>
                  <CardDescription>Choose Solo or Mentored and your billing period.</CardDescription>
                </div>
                <div className="w-48">
                  <Select
                    label="Billing period"
                    value={period}
                    onValueChange={(v) => setPeriod(v as BillingPeriod)}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "two_month", label: "Two-month (60 days)" },
                      { value: "yearly", label: "Yearly" },
                    ]}
                  />
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {(["solo", "mentored"] as const).map((planId) => {
                  const def = PLANS[planId]
                  const price = priceFor(planId, period)
                  return (
                    <div
                      key={planId}
                      className="flex flex-col justify-between gap-4 rounded-pendix border border-line bg-off-white p-5"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-semibold text-ink">{def.name}</h3>
                          <Badge variant="score">{formatMoney(price)}</Badge>
                        </div>
                        <p className="mt-1.5 text-xs text-muted">
                          {planId === "solo"
                            ? "Grading, session notes, and weekly checks up to 100 graded sessions per month."
                            : "Everything in Solo plus a matched human mentor with weekly prompt reviews."}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => subscribeMutation.mutate({ plan: planId, period })}
                        disabled={subscribeMutation.isPending || user.plan === planId}
                      >
                        {user.plan === planId ? "Current plan" : `Subscribe to ${def.name}`}
                      </Button>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </>
        )}

        {/* Credit ledger */}
        <Card>
          <CardHeader>
            <CardTitle>Credit ledger</CardTitle>
            <CardDescription>Every credit addition, session grade, assessment, and refund.</CardDescription>
          </CardHeader>
          <CardContent>
            {!credits?.ledger.length ? (
              <EmptyState title="No credit activity yet" description="Credit purchases and usage will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted">{row.created_at.slice(0, 10)}</TableCell>
                      <TableCell className="capitalize">{row.reason.replaceAll("_", " ")}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {row.amount > 0 ? `+${row.amount}` : String(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Receipts */}
        {!isTeen ? (
          <Card>
            <CardHeader>
              <CardTitle>Receipts</CardTitle>
              <CardDescription>Recent payments made on your account.</CardDescription>
            </CardHeader>
            <CardContent>
              {!summary?.receipts.length ? (
                <EmptyState title="No receipts yet" description="Completed payments will appear here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.receipts.map((receipt) => (
                      <TableRow key={receipt.id}>
                        <TableCell className="text-xs text-muted">
                          {(receipt.paid_at ?? receipt.created_at).slice(0, 10)}
                        </TableCell>
                        <TableCell className="capitalize">{receipt.kind.replaceAll("_", " ")}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatMoney(receipt.amount_cents, receipt.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">{receipt.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs text-muted">{receipt.tx_ref}</code>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  )
}

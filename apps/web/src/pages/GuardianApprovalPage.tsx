import { useMutation, useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { AuthShell } from "../components/AuthShell.js"
import { ApiClientError, apiFetch, type GuardianApprovalInfo } from "../lib/api.js"
import { Button, Card, CardContent, CardDescription, CardHeader, Skeleton } from "../ui/index.js"

export function GuardianApprovalPage() {
  const { token } = useParams({ from: "/guardian/approval/$token" })
  const [decision, setDecision] = useState<"approved" | "declined" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const infoQuery = useQuery({
    queryKey: ["guardian-approval", token],
    queryFn: () => apiFetch<GuardianApprovalInfo>(`/guardian/approval/${encodeURIComponent(token)}`),
    retry: false,
  })

  const decideMutation = useMutation({
    mutationFn: (choice: "approve" | "decline") =>
      apiFetch<{ ok: boolean; decision: "approved" | "declined" }>(
        `/guardian/approval/${encodeURIComponent(token)}`,
        {
          method: "POST",
          body: JSON.stringify(
            choice === "approve"
              ? {
                  decision: "approve",
                  consent_version: infoQuery.data?.guardian_consent_version ?? "2026-01",
                }
              : { decision: "decline" },
          ),
        },
      ),
    onSuccess: (res) => {
      setActionError(null)
      setDecision(res.decision)
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not record your decision.")
    },
  })

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {decision === "approved"
              ? "Account approved"
              : decision === "declined"
                ? "Request declined"
                : "Parent or guardian approval"}
          </h1>
          <CardDescription>
            {decision === "approved"
              ? "The teen account is now active. We also emailed you a sign-in link for your guardian view."
              : decision === "declined"
                ? "The account request has been declined and all data has been deleted."
                : "Review this request before the account becomes active."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {infoQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : null}

          {infoQuery.isError && !decision ? (
            <div role="alert" className="rounded-pendix border border-ink bg-off-white p-4 text-sm text-ink">
              {infoQuery.error instanceof ApiClientError
                ? infoQuery.error.message
                : "This approval link is invalid or has expired."}
            </div>
          ) : null}

          {infoQuery.data && !decision ? (
            <>
              <div className="rounded-pendix border border-line bg-off-white p-4 text-sm text-ink">
                <p className="font-medium">
                  {infoQuery.data.teen_display_name} asked to create a Pendix teen account.
                </p>
                <p className="mt-2 text-muted">{infoQuery.data.about_pendix}</p>
              </div>

              {actionError ? (
                <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="accent"
                  className="flex-1"
                  onClick={() => decideMutation.mutate("approve")}
                  disabled={decideMutation.isPending}
                >
                  {decideMutation.isPending ? "Saving..." : "Approve account"}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => decideMutation.mutate("decline")}
                  disabled={decideMutation.isPending}
                >
                  Decline and delete
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

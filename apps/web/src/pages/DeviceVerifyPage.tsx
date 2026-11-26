import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import { AuthShell } from "../components/AuthShell.js"
import { ApiClientError, apiFetch, type DeviceVerifyInfo } from "../lib/api.js"
import { Button, Card, CardContent, CardDescription, CardHeader, Input, Skeleton } from "../ui/index.js"

function formatCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`
  }
  return clean
}

export function DeviceVerifyPage() {
  const search = useSearch({ from: "/device/verify" })
  const initialCode = typeof search.code === "string" ? search.code : ""
  const [manualCode, setManualCode] = useState(initialCode)
  const activeCode = (initialCode || manualCode).replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  const formatted = formatCode(activeCode)
  const [resultStatus, setResultStatus] = useState<"approved" | "denied" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const infoQuery = useQuery({
    queryKey: ["device-verify-info", activeCode],
    queryFn: () =>
      apiFetch<DeviceVerifyInfo>(
        `/device/verify/info${activeCode ? `?code=${encodeURIComponent(activeCode)}` : ""}`,
      ),
    retry: false,
  })

  const approveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; status: "approved" }>("/device/approve", {
        method: "POST",
        body: JSON.stringify({ user_code: activeCode }),
      }),
    onSuccess: () => {
      setActionError(null)
      setResultStatus("approved")
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not approve this terminal.")
    },
  })

  const denyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; status: "denied" }>("/device/deny", {
        method: "POST",
        body: JSON.stringify({ user_code: activeCode }),
      }),
    onSuccess: () => {
      setActionError(null)
      setResultStatus("denied")
    },
    onError: (err) => {
      setActionError(err instanceof ApiClientError ? err.message : "Could not cancel this sign-in.")
    },
  })

  const currentRedirect = activeCode ? `/device/verify?code=${encodeURIComponent(activeCode)}` : "/device/verify"
  const viewer = infoQuery.data?.viewer ?? null

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {resultStatus === "approved"
              ? "Terminal connected"
              : resultStatus === "denied"
                ? "Sign-in cancelled"
                : "Approve terminal sign-in"}
          </h1>
          <CardDescription>
            {resultStatus === "approved"
              ? "You can return to your terminal now."
              : resultStatus === "denied"
                ? "No device was connected to your account."
                : "Check that the code matches what you see in your terminal."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {!resultStatus ? (
            <>
              <p className="text-sm font-medium text-ink">
                Is this you signing in to Pendix in your terminal?{" "}
                {formatted ? (
                  <span>
                    Code:{" "}
                    <code className="rounded bg-off-white px-2 py-0.5 font-mono text-base font-semibold text-ink">
                      {formatted}
                    </code>
                  </span>
                ) : null}
              </p>

              {!initialCode ? (
                <Input
                  label="Device code"
                  name="user_code"
                  placeholder="ABCD-EFGH"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                />
              ) : null}

              {infoQuery.data?.device_name ? (
                <p className="text-xs text-muted">Device: {infoQuery.data.device_name}</p>
              ) : null}

              {infoQuery.isLoading ? <Skeleton className="h-10 w-full" /> : null}

              {!infoQuery.isLoading && !viewer ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">Sign in to your Pendix account to approve this terminal.</p>
                  <Link
                    to="/signin"
                    search={{ redirect: currentRedirect }}
                    className="inline-flex h-10 items-center justify-center rounded-pendix bg-hot-orange px-4 text-sm font-semibold text-ink hover:opacity-95"
                  >
                    Sign in to continue
                  </Link>
                  <Link
                    to="/signup"
                    className="inline-flex h-10 items-center justify-center rounded-pendix border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-off-white"
                  >
                    Create an account
                  </Link>
                </div>
              ) : null}

              {!infoQuery.isLoading && viewer && !viewer.can_approve ? (
                <div role="alert" className="rounded-pendix border border-line bg-off-white p-4 text-sm text-ink">
                  {viewer.blocked_reason}
                </div>
              ) : null}

              {!infoQuery.isLoading && viewer && viewer.can_approve ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted">Signed in as {viewer.display_name}.</p>

                  {actionError ? (
                    <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                      {actionError}
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="accent"
                      className="flex-1"
                      onClick={() => approveMutation.mutate()}
                      disabled={!activeCode || approveMutation.isPending || denyMutation.isPending}
                    >
                      {approveMutation.isPending ? "Approving..." : "Approve terminal"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => denyMutation.mutate()}
                      disabled={!activeCode || approveMutation.isPending || denyMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  )
}

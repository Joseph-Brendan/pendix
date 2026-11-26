import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"
import { AppShell } from "../components/AppShell.js"
import { ApiClientError, apiFetch, type DeviceItem, type MeResponse, type ProfileResponse } from "../lib/api.js"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "../ui/index.js"

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Lagos",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const

export function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<ProfileResponse>("/me/profile"),
    enabled: Boolean(meQuery.data),
  })

  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<{ devices: readonly DeviceItem[] }>("/devices"),
    enabled: Boolean(meQuery.data),
  })

  const [displayName, setDisplayName] = useState("")
  const [tz, setTz] = useState("UTC")
  const [reportEmails, setReportEmails] = useState(true)
  const [gradingConsent, setGradingConsent] = useState(false)
  const [selfTeachLock, setSelfTeachLock] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.display_name)
      setTz(profileQuery.data.tz || "UTC")
      setReportEmails(profileQuery.data.session_report_emails)
      setGradingConsent(profileQuery.data.grading_consent)
      setSelfTeachLock(profileQuery.data.teach_lock === "self")
    } else if (meQuery.data) {
      setDisplayName(meQuery.data.display_name)
      setSelfTeachLock(meQuery.data.teach_lock === "self")
    }
  }, [profileQuery.data, meQuery.data])

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      const isClassLocked = meQuery.data?.teach_lock === "class"
      return apiFetch("/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName.trim(),
          tz: tz.trim() || "UTC",
          session_report_emails: reportEmails,
          grading_consent: gradingConsent,
          ...(isClassLocked ? {} : { teach_lock: selfTeachLock ? "self" : "none" }),
        }),
      })
    },
    onSuccess: async () => {
      setProfileError(null)
      setProfileSaved(true)
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      await queryClient.invalidateQueries({ queryKey: ["profile"] })
      showToast({ title: "Settings saved", description: "Your account settings were updated." })
    },
    onError: (err) => {
      setProfileSaved(false)
      setProfileError(err instanceof ApiClientError ? err.message : "Could not save settings.")
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      apiFetch("/me/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      }),
    onSuccess: () => {
      setPasswordError(null)
      setPasswordMessage("Password updated.")
      setCurrentPassword("")
      setNewPassword("")
    },
    onError: (err) => {
      setPasswordMessage(null)
      setPasswordError(err instanceof ApiClientError ? err.message : "Could not change password.")
    },
  })

  const revokeDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => apiFetch(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["devices"] })
      showToast({ title: "Device revoked", description: "That device has been signed out." })
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: () =>
      apiFetch("/me", {
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      }),
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: "/signup" })
    },
  })

  function handleSaveProfile(event: FormEvent) {
    event.preventDefault()
    setProfileSaved(false)
    saveProfileMutation.mutate()
  }

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setPasswordMessage(null)
    setPasswordError(null)
    changePasswordMutation.mutate()
  }

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-48 max-w-5xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const user = meQuery.data
  const isClassLocked = user.teach_lock === "class"
  const devices = devicesQuery.data?.devices ?? []

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-1 text-sm text-muted">
            Manage your profile, time zone, teach mode lock, and connected devices.
          </p>
        </div>

        {/* Profile and Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Profile and learning preferences</CardTitle>
            <CardDescription>Changes take effect immediately across the dashboard and terminal.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <Input label="Email" value={user.email} disabled hint="Account email address." />
              </div>

              <div>
                <Input
                  label="Time zone"
                  list="pendix-timezones"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  hint="Weekly checks arrive every Saturday at 09:00 in this time zone."
                />
                <datalist id="pendix-timezones">
                  {COMMON_TIMEZONES.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-col gap-3 rounded-pendix border border-line bg-off-white p-4">
                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={reportEmails}
                    onChange={(e) => setReportEmails(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-ink"
                  />
                  <span>
                    <strong className="font-medium">Email session reports</strong>
                    <span className="block text-xs text-muted">
                      Receive an email after each graded session. Grades always appear on your dashboard.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={gradingConsent}
                    onChange={(e) => setGradingConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-ink"
                  />
                  <span>
                    <strong className="font-medium">Allow session grading uploads</strong>
                    <span className="block text-xs text-muted">
                      Redacted session summaries are uploaded only when you consent and choose to grade.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={isClassLocked || selfTeachLock}
                    disabled={isClassLocked}
                    onChange={(e) => setSelfTeachLock(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-ink"
                  />
                  <span>
                    <strong className="font-medium">Lock teach mode on</strong>
                    <span className="block text-xs text-muted">
                      {isClassLocked
                        ? "Teach mode is locked on by your class instructor."
                        : "Keep teach mode on in the terminal so you cannot switch it off mid-session."}
                    </span>
                  </span>
                </label>
              </div>

              {profileError ? (
                <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                  {profileError}
                </div>
              ) : null}

              {profileSaved ? (
                <p role="status" className="text-sm font-medium text-ink">
                  Settings saved.
                </p>
              ) : null}

              <div>
                <Button type="submit" variant="accent" disabled={saveProfileMutation.isPending}>
                  {saveProfileMutation.isPending ? "Saving..." : "Save settings"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Choose a password of at least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <Input
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              {passwordError ? (
                <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                  {passwordError}
                </div>
              ) : null}
              {passwordMessage ? (
                <p role="status" className="text-sm font-medium text-ink">
                  {passwordMessage}
                </p>
              ) : null}

              <div>
                <Button type="submit" variant="primary" disabled={changePasswordMutation.isPending}>
                  {changePasswordMutation.isPending ? "Updating..." : "Update password"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Connected Devices */}
        <Card>
          <CardHeader>
            <CardTitle>Connected devices</CardTitle>
            <CardDescription>Revoking a device signs it out immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            {devicesQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : devices.length === 0 ? (
              <EmptyState
                title="No connected devices"
                description="Run pendix login in your terminal to connect a device."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Connected</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell className="font-medium text-ink">{device.name || "Pendix device"}</TableCell>
                      <TableCell className="text-xs text-muted">{device.created_at.slice(0, 10)}</TableCell>
                      <TableCell className="text-xs text-muted">
                        {device.last_used_at ? device.last_used_at.slice(0, 10) : "Never"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => revokeDeviceMutation.mutate(device.id)}
                          disabled={revokeDeviceMutation.isPending}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Delete account */}
        <Card>
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
            <CardDescription>
              Deleting your account permanently removes your profile, sessions, grades, and assessments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <Badge variant="neutral">Permanent action</Badge>
              <Dialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                trigger={<Button variant="danger">Delete account</Button>}
                title="Delete your Pendix account?"
                description="This removes your account and all stored data permanently. This cannot be undone."
              >
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => deleteAccountMutation.mutate()}
                    disabled={deleteAccountMutation.isPending}
                  >
                    {deleteAccountMutation.isPending ? "Deleting..." : "Confirm delete"}
                  </Button>
                </div>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

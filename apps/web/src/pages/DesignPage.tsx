import { useState } from "react"
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
  Logo,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  useToast,
} from "../ui/index.js"

export function DesignPage() {
  const [plan, setPlan] = useState("solo")
  const [dialogOpen, setDialogOpen] = useState(false)
  const { showToast } = useToast()

  return (
    <main className="min-h-screen bg-off-white px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex flex-col gap-1">
            <Logo className="text-xl" />
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Design system</h1>
            <p className="text-sm text-muted">
              Neutral surfaces, ink text, and hot orange reserved for focus, the main action, and score badges.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Buttons</CardTitle>
            <CardDescription>Primary is ink with white text. Hot orange accent appears at most once per screen.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant="accent">Main action</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inputs and Select</CardTitle>
            <CardDescription>Default, hint, error, and disabled states with hot orange focus rings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Input label="Display name" placeholder="Ada Lovelace" hint="Shown to your mentor." />
            <Input label="Email with error" defaultValue="invalid" error="Enter a valid email address." />
            <Input label="Disabled input" defaultValue="Read only" disabled />
            <Select
              label="Plan"
              value={plan}
              onValueChange={setPlan}
              options={[
                { value: "free", label: "Free" },
                { value: "solo", label: "Solo" },
                { value: "mentored", label: "Mentored" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Badges</CardTitle>
            <CardDescription>Score badges use orange tint background with ink text.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Badge variant="score">8.4 / 10</Badge>
            <Badge variant="teach">teach</Badge>
            <Badge variant="neutral">solo</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Table</CardTitle>
            <CardDescription>Clean neutral rows with code tokens in JetBrains Mono.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Billing webhooks</TableCell>
                  <TableCell>
                    <code className="text-xs">src/billing/flutterwave.ts</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="score">9 / 10</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Weekly checks</TableCell>
                  <TableCell>
                    <code className="text-xs">src/routes/assessments.ts</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="score">8 / 10</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tabs, Dialog, and Toast</CardTitle>
            <CardDescription>Radix UI primitives with full keyboard support.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Tabs
              defaultValue="overview"
              items={[
                {
                  value: "overview",
                  label: "Overview",
                  content: <p className="text-sm text-muted">Overview tab content.</p>,
                },
                {
                  value: "notes",
                  label: "Notes",
                  content: <p className="text-sm text-muted">Session notes tab content.</p>,
                },
              ]}
            />

            <div className="flex flex-wrap gap-3">
              <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                trigger={<Button variant="primary">Open dialog</Button>}
                title="Confirm weekly check"
                description="Opening this assessment uses 2 credits from your balance."
              >
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => setDialogOpen(false)}>
                    Confirm
                  </Button>
                </div>
              </Dialog>

              <Button
                variant="secondary"
                onClick={() =>
                  showToast({
                    title: "Saved",
                    description: "Your preferences have been updated.",
                  })
                }
              >
                Show toast
              </Button>
            </div>
          </CardContent>
        </Card>

        <EmptyState
          title="Nothing here yet"
          description="Empty states stay calm, clear, and explain the next step."
          action={<Button variant="primary">Start a session</Button>}
        />

        <Card>
          <CardHeader>
            <CardTitle>Skeleton</CardTitle>
            <CardDescription>Neutral loading placeholders.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

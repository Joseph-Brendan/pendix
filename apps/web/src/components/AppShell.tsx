import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { apiFetch, type MeResponse } from "../lib/api.js"
import { Badge, Button, Logo } from "../ui/index.js"

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/sessions", label: "Sessions" },
  { to: "/assessments", label: "Assessments" },
  { to: "/billing", label: "Billing" },
  { to: "/settings", label: "Settings" },
] as const

export interface AppShellProps {
  readonly user: MeResponse
  readonly children: ReactNode
}

export function AppShell({ user, children }: AppShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOutMutation = useMutation({
    mutationFn: () => apiFetch("/auth/signout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: "/signin", search: { redirect: undefined } })
    },
  })

  return (
    <div className="min-h-screen bg-off-white text-ink md:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-pendix focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:border focus:border-line"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:justify-between border-r border-line bg-white px-4 py-6">
        <div className="flex flex-col gap-6">
          <Link to="/" aria-label="Pendix home" className="px-2 rounded-md">
            <Logo className="text-lg" />
          </Link>

          <nav aria-label="Main navigation" className="flex flex-col gap-1">
            {NAV_ITEMS.filter((item) => !(user.account_kind === "teen" && item.to === "/billing")).map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "rounded-pendix px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-off-white text-ink border border-line" : "text-muted hover:bg-off-white hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-col gap-1 px-2">
            <span className="truncate text-sm font-medium text-ink">{user.display_name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{user.plan}</Badge>
              {user.teach_lock !== "none" ? <Badge variant="teach">teach</Badge> : null}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => signOutMutation.mutate()}
            disabled={signOutMutation.isPending}
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
        <Link to="/" aria-label="Pendix home" className="rounded-md">
          <Logo className="text-base" />
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOutMutation.mutate()}
          disabled={signOutMutation.isPending}
        >
          Sign out
        </Button>
      </header>

      {/* Main content */}
      <main id="main-content" className="flex-1 px-4 pb-24 pt-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-line bg-white px-2 py-2 md:hidden"
      >
        {NAV_ITEMS.filter((item) => !(user.account_kind === "teen" && item.to === "/billing")).map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-pendix px-2.5 py-1.5 text-xs font-medium",
                active ? "bg-off-white text-ink border border-line" : "text-muted",
              ].join(" ")}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

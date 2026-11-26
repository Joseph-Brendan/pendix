import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, type MeResponse } from "../lib/api.js"
import { EmptyState, Skeleton } from "../ui/index.js"

export function SectionPlaceholderPage({
  title,
  description,
}: {
  readonly title: string
  readonly description: string
}) {
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
        <Skeleton className="h-32 max-w-3xl mx-auto" />
      </main>
    )
  }

  if (!meQuery.data) return null

  return (
    <AppShell user={meQuery.data}>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <EmptyState title={title} description={description} />
      </div>
    </AppShell>
  )
}

import { RUBRIC, RUBRIC_CRITERIA } from "@pendix/shared/rubric"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AppShell } from "../components/AppShell.js"
import { apiFetch, type MeResponse, type SessionDetailResponse } from "../lib/api.js"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  useToast,
} from "../ui/index.js"

export function SessionDetailPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [copiedGradeId, setCopiedGradeId] = useState<string | null>(null)

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const detailQuery = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () => apiFetch<SessionDetailResponse>(`/sessions/${encodeURIComponent(sessionId)}`),
    enabled: Boolean(meQuery.data),
  })

  const disputeMutation = useMutation({
    mutationFn: (gradeId: string) =>
      apiFetch(`/sessions/${encodeURIComponent(sessionId)}/grades/${encodeURIComponent(gradeId)}/dispute`, {
        method: "POST",
        body: JSON.stringify({ reason: "Learner flagged grade for review" }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session-detail", sessionId] })
      showToast({
        title: "Flagged for review",
        description: "Your mentor or reviewer will take a closer look at this grade.",
      })
    },
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  async function handleCopy(gradeId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedGradeId(gradeId)
      showToast({ title: "Copied", description: "Improved prompt copied to clipboard." })
    } catch {
      showToast({ title: "Copy failed", description: "Select and copy the prompt manually." })
    }
  }

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-52 max-w-5xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const detail = detailQuery.data

  return (
    <AppShell user={meQuery.data}>
      <div className="flex flex-col gap-6">
        <div>
          <Link to="/sessions" className="text-xs font-medium text-muted hover:text-ink underline underline-offset-4">
            Back to sessions
          </Link>
        </div>

        {detailQuery.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-44 w-full" />
          </div>
        ) : !detail ? (
          <EmptyState
            title="Session not found"
            description="This session could not be loaded."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  {detail.session.project_title || "Untitled session"}
                </h1>
                <p className="mt-1 text-sm text-muted">
                  {detail.session.created_at.slice(0, 10)} ·{" "}
                  <code className="text-xs">{detail.session.model || "unknown model"}</code>
                </p>
                {detail.model_used ? (
                  <p className="mt-1 text-xs text-muted">Graded by {detail.model_used}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {detail.session.score !== null ? (
                  <Badge variant="score">Prompt score {detail.session.score}/10</Badge>
                ) : null}
                {detail.understanding ? (
                  <Badge variant="neutral">Understanding {detail.understanding.score}/10</Badge>
                ) : null}
              </div>
            </div>

            {/* Understanding & Notes */}
            <div className="grid gap-4 md:grid-cols-2">
              {detail.understanding ? (
                <Card>
                  <CardHeader>
                    <CardDescription>Understanding</CardDescription>
                    <CardTitle>{detail.understanding.score}/10</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-ink">{detail.understanding.reason}</p>
                    <p className="mt-3 text-xs text-muted">Graded by {detail.understanding.model_used}</p>
                  </CardContent>
                </Card>
              ) : null}

              {detail.notes ? (
                <Card>
                  <CardHeader>
                    <CardDescription>Session notes</CardDescription>
                    <CardTitle>What was built</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <p className="text-ink">{detail.notes.what_was_built}</p>
                    <div>
                      <p className="font-medium text-ink">Three things learned</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                        {detail.notes.learned.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-ink">Two things to work on</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                        {detail.notes.to_work_on.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs text-muted">Notes by {detail.notes.model_used}</p>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {/* Prompts breakdown */}
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                Prompts ({detail.prompts.length})
              </h2>

              {detail.prompts.map((prompt) => (
                <Card key={prompt.id}>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardDescription>Prompt {prompt.prompt_index + 1}</CardDescription>
                      <CardTitle className="text-base font-medium leading-snug">{prompt.text}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="score">{prompt.total}/10</Badge>
                      <Badge variant="neutral">{Math.round(prompt.confidence * 100)}% confidence</Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-4">
                    <div className="grid gap-2 sm:grid-cols-5">
                      {RUBRIC_CRITERIA.map((criterion) => (
                        <div
                          key={criterion}
                          className="rounded-pendix border border-line bg-off-white p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-ink">{RUBRIC[criterion].label}</span>
                            <span className="font-mono text-xs font-semibold text-ink">
                              {prompt.scores[criterion]}/2
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-muted">{prompt.reasons[criterion]}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-pendix border border-line bg-off-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Improved prompt
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleCopy(prompt.id, prompt.improved_prompt)}
                        >
                          {copiedGradeId === prompt.id ? "Copied" : "Copy improved prompt"}
                        </Button>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-ink">
                        {prompt.improved_prompt}
                      </pre>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-muted">Graded by {prompt.model_used}</span>
                      {prompt.disputed ? (
                        <Badge variant="neutral">Flagged for review</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => disputeMutation.mutate(prompt.id)}
                          disabled={disputeMutation.isPending}
                        >
                          This grade feels wrong
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          </>
        )}
      </div>
    </AppShell>
  )
}

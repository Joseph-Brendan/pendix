import { CREDIT_COSTS } from "@pendix/shared/plans"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"
import { AppShell } from "../components/AppShell.js"
import {
  ApiClientError,
  apiFetch,
  type AssessmentDetailResponse,
  type AssessmentQuestionItem,
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
  Skeleton,
  useToast,
} from "../ui/index.js"

function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    setMobile(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return mobile
}

function questionKindLabel(kind: AssessmentQuestionItem["question_kind"]): string {
  if (kind === "why") return "Why did the agent do this?"
  if (kind === "what_would_break") return "What would break if?"
  if (kind === "how_to_check") return "How would you check?"
  return "Multiple choice"
}

export function AssessmentDetailPage() {
  const { assessmentId } = useParams({ from: "/assessments/$assessmentId" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const isMobile = useIsMobileViewport()

  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [mobileStep, setMobileStep] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/me"),
    retry: false,
  })

  const detailQuery = useQuery({
    queryKey: ["assessment-detail", assessmentId],
    queryFn: () => apiFetch<AssessmentDetailResponse>(`/assessments/${encodeURIComponent(assessmentId)}`),
    enabled: Boolean(meQuery.data),
  })

  const openMutation = useMutation({
    mutationFn: (confirm: boolean) =>
      apiFetch(`/assessments/${encodeURIComponent(assessmentId)}/open`, {
        method: "POST",
        body: JSON.stringify({ confirm }),
      }),
    onSuccess: async (_data, confirmed) => {
      if (!confirmed) {
        await navigate({ to: "/assessments" })
        return
      }
      await queryClient.invalidateQueries({ queryKey: ["assessment-detail", assessmentId] })
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      setErrorMsg(null)
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.message : "Could not open this assessment.")
    },
  })

  const submitMutation = useMutation({
    mutationFn: (payload: readonly { readonly question_index: number; readonly answer: string }[]) =>
      apiFetch<AssessmentDetailResponse>(`/assessments/${encodeURIComponent(assessmentId)}/answers`, {
        method: "POST",
        body: JSON.stringify({ answers: payload }),
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(["assessment-detail", assessmentId], data)
      await queryClient.invalidateQueries({ queryKey: ["assessments"] })
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      showToast({
        title: "Assessment marked",
        description: `Score: ${data.assessment.total_score ?? 0}/10`,
      })
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.message : "Could not submit your answers.")
    },
  })

  useEffect(() => {
    if (meQuery.isError) {
      void navigate({ to: "/signin", search: { redirect: undefined } })
    }
  }, [meQuery.isError, navigate])

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-off-white p-8">
        <Skeleton className="mx-auto h-48 max-w-4xl" />
      </main>
    )
  }

  if (!meQuery.data) return null
  const user = meQuery.data
  const detail = detailQuery.data

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!detail) return
    setErrorMsg(null)
    const payload = detail.questions.map((q) => ({
      question_index: q.question_index,
      answer: (answers[q.question_index] ?? "").trim(),
    }))
    submitMutation.mutate(payload)
  }

  function renderQuestionCard(q: AssessmentQuestionItem) {
    const value = answers[q.question_index] ?? ""
    return (
      <Card key={q.question_index}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardDescription>
              Question {q.question_index + 1} of 5 · {questionKindLabel(q.question_kind)}
            </CardDescription>
            {q.reference_target ? (
              <code className="rounded bg-off-white px-2 py-0.5 text-xs text-muted">{q.reference_target}</code>
            ) : null}
          </div>
          <CardTitle className="text-base font-medium leading-snug">{q.prompt}</CardTitle>
        </CardHeader>
        <CardContent>
          {q.question_kind === "multiple_choice" && q.choices ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{q.prompt}</legend>
              {q.choices.map((choice, idx) => {
                const optionId = `q-${q.question_index}-choice-${idx}`
                return (
                  <label
                    key={choice}
                    htmlFor={optionId}
                    className="flex cursor-pointer items-start gap-2.5 rounded-pendix border border-line bg-off-white px-3 py-2.5 text-sm text-ink hover:bg-white"
                  >
                    <input
                      id={optionId}
                      type="radio"
                      name={`question-${q.question_index}`}
                      value={choice}
                      checked={value === choice}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.question_index]: choice }))}
                      className="mt-0.5 h-4 w-4 accent-ink"
                    />
                    <span>{choice}</span>
                  </label>
                )
              })}
            </fieldset>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`answer-${q.question_index}`} className="text-xs font-medium text-muted">
                Your answer
              </label>
              <textarea
                id={`answer-${q.question_index}`}
                rows={4}
                value={value}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question_index]: e.target.value }))}
                placeholder="Write a clear, concrete answer based on your code..."
                className="w-full rounded-pendix border border-line bg-white p-3 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot-orange"
              />
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-6">
        <div>
          <Link to="/assessments" className="text-xs font-medium text-muted hover:text-ink underline underline-offset-4">
            Back to assessments
          </Link>
        </div>

        {detailQuery.isLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : !detail ? (
          <EmptyState title="Assessment not found" description="We could not find that weekly check." />
        ) : detail.assessment.requires_confirmation ? (
          <Card>
            <CardHeader>
              <h1 className="text-xl font-semibold tracking-tight text-ink">Open your weekly check</h1>
              <CardDescription>
                Opening this assessment uses {detail.assessment.credit_cost ?? CREDIT_COSTS.assessment} credits from your
                balance ({detail.assessment.credit_balance ?? user.credits} available).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {errorMsg ? (
                <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                  {errorMsg}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="accent"
                  onClick={() => openMutation.mutate(true)}
                  disabled={openMutation.isPending}
                >
                  {openMutation.isPending ? "Opening..." : `Confirm and use ${CREDIT_COSTS.assessment} credits`}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => openMutation.mutate(false)}
                  disabled={openMutation.isPending}
                >
                  Not now
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : detail.assessment.status === "graded" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">Weekly check results</h1>
                <p className="mt-1 text-sm text-muted">
                  Week of {detail.assessment.week_key ?? detail.assessment.created_at.slice(0, 10)}
                  {detail.assessment.model_used ? ` · Marked by ${detail.assessment.model_used}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="score">{detail.assessment.total_score ?? 0} / 10</Badge>
                {detail.assessment.is_late ? <Badge variant="neutral">Submitted late</Badge> : null}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {detail.questions.map((q) => (
                <Card key={q.question_index}>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardDescription>
                        Question {q.question_index + 1} · {questionKindLabel(q.question_kind)}
                      </CardDescription>
                      <CardTitle className="text-base font-medium">{q.prompt}</CardTitle>
                    </div>
                    <Badge variant="score">{q.score ?? 0}/2</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <div className="rounded-pendix border border-line bg-off-white p-3">
                      <p className="text-xs font-medium text-muted">Your answer</p>
                      <p className="mt-1 text-ink">{q.answer || "(No answer)"}</p>
                    </div>
                    <p className="text-sm text-muted">{q.feedback}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">Weekly check</h1>
                <p className="mt-1 text-sm text-muted">
                  Due by {detail.assessment.due_at.slice(0, 10)}. Late answers are still marked.
                </p>
              </div>
              {isMobile ? (
                <Badge variant="neutral">
                  Question {mobileStep + 1} of {detail.questions.length}
                </Badge>
              ) : null}
            </div>

            {errorMsg ? (
              <div role="alert" className="rounded-pendix border border-ink bg-off-white px-3 py-2 text-sm text-ink">
                {errorMsg}
              </div>
            ) : null}

            {isMobile ? (
              <>
                {detail.questions[mobileStep] ? renderQuestionCard(detail.questions[mobileStep]!) : null}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setMobileStep((s) => Math.max(0, s - 1))}
                    disabled={mobileStep === 0}
                  >
                    Previous
                  </Button>
                  {mobileStep < detail.questions.length - 1 ? (
                    <Button
                      variant="primary"
                      onClick={() => setMobileStep((s) => Math.min(detail.questions.length - 1, s + 1))}
                    >
                      Next question
                    </Button>
                  ) : (
                    <Button type="submit" variant="accent" disabled={submitMutation.isPending}>
                      {submitMutation.isPending ? "Marking..." : "Submit answers"}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                {detail.questions.map((q) => renderQuestionCard(q))}
                <div className="flex justify-end">
                  <Button type="submit" variant="accent" size="lg" disabled={submitMutation.isPending}>
                    {submitMutation.isPending ? "Marking..." : "Submit answers"}
                  </Button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </AppShell>
  )
}

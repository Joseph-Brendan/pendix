import {
  ASSESSMENT_QUESTION_COUNT,
  markAssessment,
  type AssessmentQuestionKind,
  type GraderModelFactory,
} from "@pendix/grader"
import type { GraderTier } from "@pendix/shared/models"
import { CREDIT_COSTS } from "@pendix/shared/plans"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { CloudAuth } from "../auth.js"
import { getCreditBalance, insertCreditEntry } from "../credits.js"
import type { CloudDatabase } from "../db/index.js"
import { schema } from "../db/schema.js"
import { getEntitlements } from "../entitlements.js"
import { AppError } from "../errors.js"
import { requireActiveAccount, requireAuth, type AuthVariables } from "../middleware/auth.js"

const OpenAssessmentSchema = z.object({
  confirm: z.boolean(),
})

const SubmitAnswersSchema = z.object({
  answers: z.union([
    z
      .array(
        z.object({
          question_index: z.number().int().min(0).max(ASSESSMENT_QUESTION_COUNT - 1),
          answer: z.string(),
        }),
      )
      .length(ASSESSMENT_QUESTION_COUNT),
    z.array(z.string()).length(ASSESSMENT_QUESTION_COUNT),
  ]),
})

export interface AssessmentsRoutesDeps {
  readonly auth: CloudAuth
  readonly db: CloudDatabase
  readonly now: () => number
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly modelFactory?: GraderModelFactory
}

type ViewerAccess = "owner" | "mentor" | "instructor" | "admin" | null

async function resolveViewerAccess(
  db: CloudDatabase,
  viewerId: string,
  viewerRole: string,
  learnerUserId: string,
): Promise<ViewerAccess> {
  if (viewerId === learnerUserId) return "owner"
  if (viewerRole === "admin") return "admin"

  const [activeMatch] = await db
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.mentor_user_id, viewerId),
        eq(schema.matches.learner_user_id, learnerUserId),
        eq(schema.matches.status, "active"),
      ),
    )
  if (activeMatch) return "mentor"

  // SPEC S17: Visible to instructor/owner if group grade_visibility allows.
  const viewerGroups = await db
    .select({
      group_id: schema.groupMembers.group_id,
      role: schema.groupMembers.role,
      grade_visibility: schema.groups.grade_visibility,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groupMembers.group_id, schema.groups.id))
    .where(
      and(
        eq(schema.groupMembers.user_id, viewerId),
        inArray(schema.groupMembers.role, ["owner", "instructor"]),
      ),
    )

  if (viewerGroups.length > 0) {
    const allowedGroupIds = viewerGroups
      .filter((g) => g.role === "owner" || g.grade_visibility !== "owner_only")
      .map((g) => g.group_id)

    if (allowedGroupIds.length > 0) {
      const [learnerMembership] = await db
        .select({ id: schema.groupMembers.id })
        .from(schema.groupMembers)
        .where(
          and(
            eq(schema.groupMembers.user_id, learnerUserId),
            inArray(schema.groupMembers.group_id, allowedGroupIds),
          ),
        )
      if (learnerMembership) return "instructor"
    }
  }

  return null
}

function serializeAssessmentRow(row: typeof schema.assessments.$inferSelect) {
  return {
    id: row.id,
    user_id: row.user_id,
    week_key: row.week_key,
    status: row.status,
    total_score: row.total_score,
    is_late: row.is_late,
    model_used: row.model_used,
    due_at: row.due_at.toISOString(),
    opened_at: row.opened_at ? row.opened_at.toISOString() : null,
    submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  }
}

function serializeQuestionRow(row: typeof schema.assessmentAnswers.$inferSelect) {
  return {
    question_index: row.question_index,
    question_kind: row.question_kind as AssessmentQuestionKind,
    reference_target: row.reference_target,
    prompt: row.prompt,
    choices: Array.isArray(row.choices) ? (row.choices as string[]) : undefined,
    answer: row.answer,
    score: row.score,
    feedback: row.feedback,
  }
}

async function openAssessmentForOwner(deps: {
  readonly db: CloudDatabase
  readonly userId: string
  readonly assessmentId: string
  readonly confirmed: boolean
  readonly nowDate: Date
}): Promise<{
  readonly assessment: typeof schema.assessments.$inferSelect
  readonly requiresConfirmation: boolean
  readonly chargedCredits: number
  readonly creditBalance: number
}> {
  const ent = await getEntitlements(deps.db, deps.userId, deps.nowDate)

  return deps.db.transaction(async (tx) => {
    // Lock user row first to serialize concurrent credit spends cleanly.
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, deps.userId)).for("update")

    const [assessment] = await tx
      .select()
      .from(schema.assessments)
      .where(and(eq(schema.assessments.id, deps.assessmentId), eq(schema.assessments.user_id, deps.userId)))
      .for("update")

    if (!assessment) {
      throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found.")
    }

    const currentBalance = await getCreditBalance(tx, deps.userId)
    if (assessment.status !== "available" || assessment.opened_at !== null) {
      return {
        assessment,
        requiresConfirmation: false,
        chargedCredits: 0,
        creditBalance: currentBalance,
      }
    }

    // Subscribers open weekly assessments at no credit charge.
    if (ent.plan !== "free") {
      const [opened] = await tx
        .update(schema.assessments)
        .set({ status: "opened", opened_at: deps.nowDate })
        .where(eq(schema.assessments.id, assessment.id))
        .returning()
      return {
        assessment: opened!,
        requiresConfirmation: false,
        chargedCredits: 0,
        creditBalance: currentBalance,
      }
    }

    // Credit users must confirm before 2 credits are charged.
    if (!deps.confirmed) {
      return {
        assessment,
        requiresConfirmation: true,
        chargedCredits: 0,
        creditBalance: currentBalance,
      }
    }

    if (currentBalance < CREDIT_COSTS.assessment) {
      throw new AppError(
        402,
        "NO_CREDITS",
        `Opening a weekly assessment requires ${CREDIT_COSTS.assessment} credits.`,
      )
    }

    await insertCreditEntry(tx, {
      userId: deps.userId,
      amount: -CREDIT_COSTS.assessment,
      reason: "assessment",
      referenceId: assessment.id,
      createdAt: deps.nowDate,
    })

    const [opened] = await tx
      .update(schema.assessments)
      .set({ status: "opened", opened_at: deps.nowDate })
      .where(eq(schema.assessments.id, assessment.id))
      .returning()

    return {
      assessment: opened!,
      requiresConfirmation: false,
      chargedCredits: CREDIT_COSTS.assessment,
      creditBalance: currentBalance - CREDIT_COSTS.assessment,
    }
  })
}

export function createAssessmentsRoutes(deps: AssessmentsRoutesDeps) {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = requireAuth(deps)
  const activeMiddleware = requireActiveAccount()

  router.get("/assessments", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const requestedLearnerId = c.req.query("learner_user_id")?.trim()
    const targetUserId = requestedLearnerId || user.id

    const access = await resolveViewerAccess(deps.db, user.id, user.role, targetUserId)
    if (!access) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to view these assessments.")
    }

    const rows = await deps.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.user_id, targetUserId))
      .orderBy(desc(schema.assessments.created_at))

    return c.json({
      assessments: rows.map((row) => serializeAssessmentRow(row)),
    })
  })

  router.get("/assessments/:id", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const assessmentId = c.req.param("id")
    const nowDate = new Date(deps.now())

    const [existing] = await deps.db.select().from(schema.assessments).where(eq(schema.assessments.id, assessmentId))
    if (!existing) {
      throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found.")
    }

    const access = await resolveViewerAccess(deps.db, user.id, user.role, existing.user_id)
    if (!access) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to view this assessment.")
    }

    // Mentors, instructors, and admins view learner answers and scores without triggering credit charges.
    if (access !== "owner") {
      const questions = await deps.db
        .select()
        .from(schema.assessmentAnswers)
        .where(eq(schema.assessmentAnswers.assessment_id, existing.id))
        .orderBy(asc(schema.assessmentAnswers.question_index))

      return c.json({
        assessment: serializeAssessmentRow(existing),
        questions: questions.map((q) => serializeQuestionRow(q)),
      })
    }

    const confirmed = c.req.query("confirm") === "true"
    const opened = await openAssessmentForOwner({
      db: deps.db,
      userId: user.id,
      assessmentId: existing.id,
      confirmed,
      nowDate,
    })

    if (opened.requiresConfirmation) {
      return c.json({
        assessment: {
          ...serializeAssessmentRow(opened.assessment),
          requires_confirmation: true,
          credit_cost: CREDIT_COSTS.assessment,
          credit_balance: opened.creditBalance,
        },
        questions: [],
      })
    }

    const questions = await deps.db
      .select()
      .from(schema.assessmentAnswers)
      .where(eq(schema.assessmentAnswers.assessment_id, opened.assessment.id))
      .orderBy(asc(schema.assessmentAnswers.question_index))

    return c.json({
      assessment: {
        ...serializeAssessmentRow(opened.assessment),
        requires_confirmation: false,
        charged_credits: opened.chargedCredits,
        credit_balance: opened.creditBalance,
      },
      questions: questions.map((q) => serializeQuestionRow(q)),
    })
  })

  router.post("/assessments/:id/open", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const assessmentId = c.req.param("id")
    const body = OpenAssessmentSchema.parse(await c.req.json())
    const nowDate = new Date(deps.now())

    const [existing] = await deps.db.select().from(schema.assessments).where(eq(schema.assessments.id, assessmentId))
    if (!existing) {
      throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found.")
    }
    if (existing.user_id !== user.id) {
      throw new AppError(403, "FORBIDDEN", "Only the learner can open their assessment.")
    }

    if (!body.confirm) {
      const creditBalance = await getCreditBalance(deps.db, user.id)
      return c.json({
        declined: true,
        charged: false,
        credit_balance: creditBalance,
        assessment: serializeAssessmentRow(existing),
      })
    }

    const opened = await openAssessmentForOwner({
      db: deps.db,
      userId: user.id,
      assessmentId: existing.id,
      confirmed: true,
      nowDate,
    })

    const questions = await deps.db
      .select()
      .from(schema.assessmentAnswers)
      .where(eq(schema.assessmentAnswers.assessment_id, opened.assessment.id))
      .orderBy(asc(schema.assessmentAnswers.question_index))

    return c.json({
      declined: false,
      charged: opened.chargedCredits > 0,
      charged_credits: opened.chargedCredits,
      credit_balance: opened.creditBalance,
      assessment: serializeAssessmentRow(opened.assessment),
      questions: questions.map((q) => serializeQuestionRow(q)),
    })
  })

  router.post("/assessments/:id/answers", authMiddleware, activeMiddleware, async (c) => {
    const user = c.get("user")!
    const assessmentId = c.req.param("id")
    const body = SubmitAnswersSchema.parse(await c.req.json())
    const nowDate = new Date(deps.now())

    const [existing] = await deps.db.select().from(schema.assessments).where(eq(schema.assessments.id, assessmentId))
    if (!existing) {
      throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found.")
    }
    if (existing.user_id !== user.id) {
      throw new AppError(403, "FORBIDDEN", "Only the learner can answer their assessment.")
    }
    if (existing.status === "graded") {
      throw new AppError(409, "ALREADY_SUBMITTED", "This assessment has already been marked.")
    }

    let assessment = existing
    if (assessment.status === "available") {
      const ent = await getEntitlements(deps.db, user.id, nowDate)
      if (ent.plan === "free") {
        throw new AppError(
          402,
          "ASSESSMENT_NOT_OPENED",
          `Confirm opening this assessment for ${CREDIT_COSTS.assessment} credits before submitting answers.`,
        )
      }
      const opened = await openAssessmentForOwner({
        db: deps.db,
        userId: user.id,
        assessmentId: assessment.id,
        confirmed: true,
        nowDate,
      })
      assessment = opened.assessment
    }

    const normalizedAnswers = body.answers.map((entry, idx) =>
      typeof entry === "string"
        ? { question_index: idx, answer: entry }
        : { question_index: entry.question_index, answer: entry.answer },
    )

    const questionRows = await deps.db
      .select()
      .from(schema.assessmentAnswers)
      .where(eq(schema.assessmentAnswers.assessment_id, assessment.id))
      .orderBy(asc(schema.assessmentAnswers.question_index))

    if (questionRows.length !== ASSESSMENT_QUESTION_COUNT) {
      throw new AppError(500, "INVALID_ASSESSMENT", "Assessment does not have 5 questions.")
    }

    const tier: GraderTier = assessment.tier === "subscriber" ? "subscriber" : "credit"
    const marked = await markAssessment(
      questionRows.map((row) => ({
        question_index: row.question_index,
        question_kind: row.question_kind as AssessmentQuestionKind,
        reference_target: row.reference_target || "session",
        prompt: row.prompt,
        choices: Array.isArray(row.choices) ? (row.choices as string[]) : undefined,
        reference_answer: row.reference_answer ?? row.prompt,
      })),
      normalizedAnswers,
      tier,
      {
        env: deps.env,
        modelFactory: deps.modelFactory,
      },
    )

    const answerByIndex = new Map(normalizedAnswers.map((a) => [a.question_index, a.answer]))
    const markByIndex = new Map(marked.marks.map((m) => [m.question_index, m]))
    const isLate = nowDate.getTime() > assessment.due_at.getTime()
    const modelLabel = `${marked.model_used.provider}/${marked.model_used.model}`

    const updatedAssessment = await deps.db.transaction(async (tx) => {
      for (const row of questionRows) {
        const answerText = answerByIndex.get(row.question_index) ?? ""
        const mark = markByIndex.get(row.question_index)!
        await tx
          .update(schema.assessmentAnswers)
          .set({
            answer: answerText,
            score: mark.score,
            feedback: mark.feedback,
          })
          .where(eq(schema.assessmentAnswers.id, row.id))
      }

      const [updated] = await tx
        .update(schema.assessments)
        .set({
          status: "graded",
          total_score: marked.total,
          submitted_at: nowDate,
          is_late: isLate,
          model_used: modelLabel,
        })
        .where(eq(schema.assessments.id, assessment.id))
        .returning()

      return updated!
    })

    const updatedQuestions = await deps.db
      .select()
      .from(schema.assessmentAnswers)
      .where(eq(schema.assessmentAnswers.assessment_id, assessment.id))
      .orderBy(asc(schema.assessmentAnswers.question_index))

    return c.json({
      assessment: serializeAssessmentRow(updatedAssessment),
      questions: updatedQuestions.map((q) => serializeQuestionRow(q)),
    })
  })

  return router
}

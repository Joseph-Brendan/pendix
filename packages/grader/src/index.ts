/**
 * @pendix/grader: API-only session grading package.
 * Never import this package from terminal, extension, or browser bundles.
 */
export {
  gradeSession,
  type GradeSessionOptions,
  type GradeSessionRecordInput,
  type PromptGradeWithModel,
  type SessionGradeResult,
} from "./grade-session.js"

export {
  GraderError,
  GraderModelError,
  GraderValidationError,
  createDefaultModelFactory,
  formatValidationError,
  isStructuredValidationError,
  runStructuredWithFallback,
  type GraderModelFactory,
} from "./models.js"

export {
  buildBatchPrompt,
  loadGradeInstructions,
  type BatchPromptInput,
  type SessionOverview,
  type SessionPromptItem,
} from "./prompt.js"

export {
  IndexedPromptGradeSchema,
  createBatchResponseSchema,
  type BatchGradeOutput,
  type IndexedPromptGrade,
} from "./schemas.js"

export {
  FakeModel,
  buildDefaultBatchResponse,
  type FakeModelCall,
  type FakeModelHandler,
  type FakeModelOptions,
} from "./fake-model.js"

export {
  evaluateGoldenAgreement,
  filterEvaluationPrompts,
  formatGoldenReportMarkdown,
  gradeGoldenPrompts,
  type CriterionAgreementStats,
  type CriterionDiffDetail,
  type GoldenAgreementReport,
  type GoldenDisagreement,
  type GoldenPromptItem,
  type GradeGoldenPromptsOptions,
  type GradeGoldenPromptsResult,
  type ModelPromptJudgment,
} from "./golden.js"

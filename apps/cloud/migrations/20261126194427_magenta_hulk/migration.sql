ALTER TABLE "assessment_answers" ADD COLUMN "reference_target" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD COLUMN "choices" jsonb;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD COLUMN "reference_answer" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "week_key" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "tier" text DEFAULT 'credit' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "model_used" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "is_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_user_week_idx" ON "assessments" ("user_id","week_key");
ALTER TABLE "jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "session_notes" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "report_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_report_emails" boolean DEFAULT true NOT NULL;
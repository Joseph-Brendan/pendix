ALTER TABLE "group_members" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "seat_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "pending_seat_removals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "refund_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "flutterwave_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "flutterwave_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_period_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_plans_plan_period_currency_idx" ON "billing_plans" ("plan","period","currency");
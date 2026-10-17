CREATE TYPE "public"."day_close_kind" AS ENUM('manual', 'automatic');--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'left_unpaid';--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"staff_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"date" date NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"float_cents" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "day_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"day_id" uuid NOT NULL,
	"kind" "day_close_kind" NOT NULL,
	"float_cents" integer NOT NULL,
	"expected_cents" integer NOT NULL,
	"counted_cents" integer,
	"difference_cents" integer,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"other_cents" integer DEFAULT 0 NOT NULL,
	"report" jsonb NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "day_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_day_id_business_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."business_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_closed_by_staff_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_time" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_days_date" ON "business_days" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "business_days_open" ON "business_days" USING btree ("tenant_id") WHERE "business_days"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "day_closes_number" ON "day_closes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "day_closes_day" ON "day_closes" USING btree ("day_id");--> statement-breakpoint
CREATE INDEX "order_events_day" ON "order_events" USING btree ("day_id");
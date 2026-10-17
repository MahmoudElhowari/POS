CREATE TYPE "public"."payment_method" AS ENUM('cash', 'wallet');--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'discount';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'delivery_fee';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'payment';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'void';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'refund';--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"tendered_cents" integer NOT NULL,
	"change_cents" integer DEFAULT 0 NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_event_id_order_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."order_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_order" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key" ON "settings" USING btree ("tenant_id","key");--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
ALTER TYPE "public"."order_event_kind" ADD VALUE 'out_for_delivery';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'returned';--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_name" ON "drivers" USING btree ("tenant_id","name");
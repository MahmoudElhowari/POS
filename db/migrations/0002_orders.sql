CREATE TYPE "public"."order_event_kind" AS ENUM('sent');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('dine_in', 'pickup', 'delivery');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"area" text DEFAULT '' NOT NULL,
	"directions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "held_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_event_kind" NOT NULL,
	"staff_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"size_key" text NOT NULL,
	"size_name_ar" text NOT NULL,
	"size_name_en" text NOT NULL,
	"other_half_id" uuid,
	"other_half_name_ar" text,
	"other_half_name_en" text,
	"addons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"removals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"qty" integer NOT NULL,
	"unit_cents" integer NOT NULL,
	"total_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"business_date" date NOT NULL,
	"number" integer NOT NULL,
	"type" "order_type" NOT NULL,
	"table_no" integer,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"delivery_area" text DEFAULT '' NOT NULL,
	"delivery_directions" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"total_cents" integer NOT NULL,
	"staff_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "held_orders" ADD CONSTRAINT "held_orders_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone" ON "customers" USING btree ("tenant_id","phone") WHERE "customers"."phone" is not null;--> statement-breakpoint
CREATE INDEX "held_orders_tenant" ON "held_orders" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "order_events_order" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_order" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_daily_number" ON "orders" USING btree ("tenant_id","business_date","number");
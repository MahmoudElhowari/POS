CREATE TYPE "public"."addon_group" AS ENUM('crust_stuffing', 'extra');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('pizza', 'calzone', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('single', 'combo');--> statement-breakpoint
CREATE TYPE "public"."price_change_reason" AS ENUM('edit', 'bulk', 'import');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'manager', 'cashier');--> statement-breakpoint
CREATE TABLE "addon_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"addon_id" uuid NOT NULL,
	"size_key" text NOT NULL,
	"price_cents" integer
);
--> statement-breakpoint
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"group" "addon_group" NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"size_key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"price_cents" integer,
	"available" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"kind" "category_kind" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" "item_type" DEFAULT 'single' NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"desc_ar" text DEFAULT '' NOT NULL,
	"desc_en" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"half_and_half" boolean DEFAULT false NOT NULL,
	"removable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"included_addons" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"reason" "price_change_reason" NOT NULL,
	"percent_bp" integer,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"change_id" uuid NOT NULL,
	"target" text NOT NULL,
	"target_id" uuid NOT NULL,
	"old_cents" integer,
	"new_cents" integer
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addon_prices" ADD CONSTRAINT "addon_prices_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sizes" ADD CONSTRAINT "item_sizes_item_id_menu_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_change_id_price_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."price_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addon_prices_key" ON "addon_prices" USING btree ("addon_id","size_key");--> statement-breakpoint
CREATE UNIQUE INDEX "addons_key" ON "addons" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "item_sizes_key" ON "item_sizes" USING btree ("item_id","size_key");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_categories_key" ON "menu_categories" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_key" ON "menu_items" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "menu_items_category" ON "menu_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "price_history_target" ON "price_history" USING btree ("target_id");
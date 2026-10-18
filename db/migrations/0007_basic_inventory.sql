CREATE TYPE "public"."stock_move_kind" AS ENUM('delivery', 'count', 'waste', 'sale', 'void');--> statement-breakpoint
CREATE TYPE "public"."stock_unit" AS ENUM('g', 'ml', 'piece');--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name_ar" text NOT NULL,
	"unit" "stock_unit" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"item_id" uuid,
	"category_kind" "category_kind",
	"size_key" text,
	"qty" integer NOT NULL,
	"takeaway_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"kind" "stock_move_kind" NOT NULL,
	"qty" integer NOT NULL,
	"cost_cents" integer,
	"supplier" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"order_id" uuid,
	"staff_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_links" ADD CONSTRAINT "stock_links_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_links" ADD CONSTRAINT "stock_links_item_id_menu_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_name" ON "stock_items" USING btree ("tenant_id","name_ar");--> statement-breakpoint
CREATE INDEX "stock_links_item" ON "stock_links" USING btree ("tenant_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_moves_item" ON "stock_moves" USING btree ("tenant_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "stock_moves_order" ON "stock_moves" USING btree ("order_id");
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Every table has tenant_id and every query filters by it (CLAUDE.md rule 2).

export const printJobStatus = pgEnum("print_job_status", ["queued", "printing", "done", "failed"]);

export const printJobs = pgTable(
  "print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    printer: text("printer").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: printJobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    printedAt: timestamp("printed_at", { withTimezone: true }),
  },
  (t) => [index("print_jobs_due_idx").on(t.tenantId, t.status, t.nextAttemptAt)],
);

export type PrintJob = typeof printJobs.$inferSelect;

// ── Menu (Milestone 2) ────────────────────────────────────────────────

export const categoryKind = pgEnum("category_kind", ["pizza", "calzone", "other"]);
/** "combo" is reserved so combos can be added later without a schema rewrite. */
export const itemType = pgEnum("item_type", ["single", "combo"]);
export const addonGroup = pgEnum("addon_group", ["crust_stuffing", "extra"]);

export interface Ingredient {
  ar: string;
  en: string;
}

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    kind: categoryKind("kind").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("menu_categories_key").on(t.tenantId, t.key)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    categoryId: uuid("category_id").notNull().references(() => menuCategories.id),
    key: text("key").notNull(),
    type: itemType("type").notNull().default("single"),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    descAr: text("desc_ar").notNull().default(""),
    descEn: text("desc_en").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    available: boolean("available").notNull().default(true),
    halfAndHalf: boolean("half_and_half").notNull().default(false),
    removable: jsonb("removable").$type<Ingredient[]>().notNull().default(sql`'[]'::jsonb`),
    includedAddons: text("included_addons").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [uniqueIndex("menu_items_key").on(t.tenantId, t.key), index("menu_items_category").on(t.categoryId)],
);

export const itemSizes = pgTable(
  "item_sizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    itemId: uuid("item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }),
    sizeKey: text("size_key").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    /** Null until a price is set; unpriced sizes are hidden from the order screen. */
    priceCents: integer("price_cents"),
    available: boolean("available").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("item_sizes_key").on(t.itemId, t.sizeKey)],
);

export const addons = pgTable(
  "addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    group: addonGroup("group").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    available: boolean("available").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("addons_key").on(t.tenantId, t.key)],
);

export const addonPrices = pgTable(
  "addon_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    addonId: uuid("addon_id").notNull().references(() => addons.id, { onDelete: "cascade" }),
    sizeKey: text("size_key").notNull(),
    priceCents: integer("price_cents"),
  },
  (t) => [uniqueIndex("addon_prices_key").on(t.addonId, t.sizeKey)],
);

export const priceChangeReason = pgEnum("price_change_reason", ["edit", "bulk", "import"]);

/** Every price change, with who made it. Prices change only through this trail. */
export const priceChanges = pgTable("price_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  reason: priceChangeReason("reason").notNull(),
  /** Bulk change in basis points (+7% = 700). */
  percentBp: integer("percent_bp"),
  staffId: uuid("staff_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    changeId: uuid("change_id").notNull().references(() => priceChanges.id),
    target: text("target").$type<"item_size" | "addon_price">().notNull(),
    targetId: uuid("target_id").notNull(),
    oldCents: integer("old_cents"),
    newCents: integer("new_cents"),
  },
  (t) => [index("price_history_target").on(t.targetId)],
);

// ── Staff and sessions ────────────────────────────────────────────────

export const staffRole = pgEnum("staff_role", ["admin", "manager", "cashier"]);

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  role: staffRole("role").notNull(),
  pinHash: text("pin_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MenuCategory = typeof menuCategories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type ItemSize = typeof itemSizes.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type AddonPrice = typeof addonPrices.$inferSelect;
export type Staff = typeof staff.$inferSelect;

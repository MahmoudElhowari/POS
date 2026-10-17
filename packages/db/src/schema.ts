import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

// ── Customers and orders (Milestone 3) ────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    /** Optional; one customer per phone number. */
    phone: text("phone"),
    area: text("area").notNull().default(""),
    directions: text("directions").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customers_phone").on(t.tenantId, t.phone).where(sql`${t.phone} is not null`)],
);

/**
 * Orders on hold. These are drafts the cashier can still change, so they live
 * apart from `orders`, which are never updated or deleted once sent.
 */
export const heldOrders = pgTable(
  "held_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull().references(() => staff.id),
    draft: jsonb("draft").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("held_orders_tenant").on(t.tenantId, t.updatedAt)],
);

export const orderType = pgEnum("order_type", ["dine_in", "pickup", "delivery"]);

/** A sent order. Append-only (CLAUDE.md rule 3): changes are order_events rows. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    /** Store-local day the order was sent on; numbers restart at 1 each day. */
    businessDate: date("business_date").notNull(),
    number: integer("number").notNull(),
    type: orderType("type").notNull(),
    tableNo: integer("table_no"),
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    deliveryArea: text("delivery_area").notNull().default(""),
    deliveryDirections: text("delivery_directions").notNull().default(""),
    note: text("note").notNull().default(""),
    /** Sum of the lines. Discounts, delivery fee and payments are order_events. */
    totalCents: integer("total_cents").notNull(),
    /** Tax rate included in the prices when the order was sent (5% = 500). */
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    staffId: uuid("staff_id").notNull().references(() => staff.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("orders_daily_number").on(t.tenantId, t.businessDate, t.number)],
);

export interface OrderLineAddon {
  key: string;
  nameAr: string;
  nameEn: string;
  cents: number;
}

/** One line of a sent order, with names and prices frozen at the time of sale. */
export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    sizeKey: text("size_key").notNull(),
    sizeNameAr: text("size_name_ar").notNull(),
    sizeNameEn: text("size_name_en").notNull(),
    otherHalfId: uuid("other_half_id"),
    otherHalfNameAr: text("other_half_name_ar"),
    otherHalfNameEn: text("other_half_name_en"),
    addons: jsonb("addons").$type<OrderLineAddon[]>().notNull().default(sql`'[]'::jsonb`),
    removals: jsonb("removals").$type<Ingredient[]>().notNull().default(sql`'[]'::jsonb`),
    note: text("note").notNull().default(""),
    qty: integer("qty").notNull(),
    unitCents: integer("unit_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (t) => [index("order_lines_order").on(t.orderId)],
);

/** "left_unpaid": a manager closed the day leaving this (non-delivery) order unpaid. */
export const orderEventKind = pgEnum("order_event_kind", ["sent", "discount", "delivery_fee", "payment", "void", "refund", "left_unpaid"]);

/**
 * Everything that happens to an order after it is sent. Money events carry an
 * amount; the order's balance is always worked out from them, never stored.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    kind: orderEventKind("kind").notNull(),
    staffId: uuid("staff_id").notNull().references(() => staff.id),
    amountCents: integer("amount_cents"),
    /** The manager who approved it (discounts). */
    approvedBy: uuid("approved_by").references(() => staff.id),
    reason: text("reason"),
    note: text("note").notNull().default(""),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    /** The business day it counts on (Milestone 5); null on events from before days existed. */
    dayId: uuid("day_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order").on(t.orderId), index("order_events_day").on(t.dayId)],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "wallet"]);

/** One tender per payment event. Cash only for now; "wallet" is reserved. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    eventId: uuid("event_id").notNull().references(() => orderEvents.id),
    method: paymentMethod("method").notNull(),
    /** What went against the bill. */
    amountCents: integer("amount_cents").notNull(),
    /** What the customer handed over (cash). */
    tenderedCents: integer("tendered_cents").notNull(),
    changeCents: integer("change_cents").notNull().default(0),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_order").on(t.orderId)],
);

/** Per-restaurant settings (rule 9): tax, receipt details. Changing one never rewrites past orders. */
export const settings = pgTable(
  "settings",
  {
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => staff.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("settings_key").on(t.tenantId, t.key)],
);

// ── Close of day (Milestone 5) ────────────────────────────────────────

/**
 * One store day per restaurant. It runs from when it opens until its Z, or
 * until the automatic close (4 AM by default) if nobody runs one.
 */
export const businessDays = pgTable(
  "business_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    date: date("date").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    /** Cash left in the drawer for change, typed in by a manager. */
    floatCents: integer("float_cents").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("business_days_date").on(t.tenantId, t.date),
    // Only one open day per restaurant.
    uniqueIndex("business_days_open").on(t.tenantId).where(sql`${t.closedAt} is null`),
  ],
);

export const dayCloseKind = pgEnum("day_close_kind", ["manual", "automatic"]);

export interface NoteCount {
  pounds: number;
  count: number;
}

/** A Z report. Insert-only: the report is frozen as it was when the day closed. */
export const dayCloses = pgTable(
  "day_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    /** Z 1, Z 2 … per restaurant. */
    number: integer("number").notNull(),
    dayId: uuid("day_id").notNull().references(() => businessDays.id),
    kind: dayCloseKind("kind").notNull(),
    floatCents: integer("float_cents").notNull(),
    expectedCents: integer("expected_cents").notNull(),
    /** Null when the day closed automatically without a count. */
    countedCents: integer("counted_cents"),
    differenceCents: integer("difference_cents"),
    notes: jsonb("notes").$type<NoteCount[]>().notNull().default(sql`'[]'::jsonb`),
    otherCents: integer("other_cents").notNull().default(0),
    report: jsonb("report").notNull(),
    closedBy: uuid("closed_by").references(() => staff.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("day_closes_number").on(t.tenantId, t.number), uniqueIndex("day_closes_day").on(t.dayId)],
);

/** Who changed what outside order history: settings, staff, the float, day closes (rule 11). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    staffId: uuid("staff_id").references(() => staff.id),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_time").on(t.tenantId, t.createdAt)],
);

export type BusinessDay = typeof businessDays.$inferSelect;
export type DayClose = typeof dayCloses.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;

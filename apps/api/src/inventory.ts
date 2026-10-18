import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, itemSizes, menuCategories, menuItems, staff, stockItems, stockLinks, stockMoves } from "@pos/db";
import { type CategoryKind, type OrderType, type SoldLine, type StockLinkRule, type StockUnit, stockUsed } from "@pos/shared";
import type { AuditLog } from "./audit.js";
import type { DayStore, Tx } from "./days.js";

/** Why an inventory action was refused; the screen shows each one. */
export class StockRefused extends Error {
  constructor(readonly code: "not_found" | "duplicate" | "inactive" | "bad_link" | "bad_qty") {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Takes the goods an order uses off the stock, inside the transaction that sends it. */
export async function takeStock(tx: Tx, tenantId: string, orderId: string, type: OrderType, lines: SoldLine[], staffId: string) {
  const links = await tx
    .select({
      stockItemId: stockLinks.stockItemId,
      itemId: stockLinks.itemId,
      categoryKind: stockLinks.categoryKind,
      sizeKey: stockLinks.sizeKey,
      qty: stockLinks.qty,
      takeawayOnly: stockLinks.takeawayOnly,
    })
    .from(stockLinks)
    .innerJoin(stockItems, eq(stockItems.id, stockLinks.stockItemId))
    .where(and(eq(stockLinks.tenantId, tenantId), eq(stockItems.active, true)));
  const used = stockUsed(lines, links satisfies StockLinkRule[], type);
  if (!used.size) return;
  await tx.insert(stockMoves).values([...used].map(([stockItemId, qty]) => ({ tenantId, stockItemId, kind: "sale" as const, qty: -qty, orderId, staffId })));
}

/** A voided order gives back what it used. */
export async function returnStock(tx: Tx, tenantId: string, orderId: string, staffId: string) {
  const rows = await tx
    .select({ stockItemId: stockMoves.stockItemId, qty: sql<number>`sum(${stockMoves.qty})::int` })
    .from(stockMoves)
    .where(and(eq(stockMoves.tenantId, tenantId), eq(stockMoves.orderId, orderId), inArray(stockMoves.kind, ["sale", "void"])))
    .groupBy(stockMoves.stockItemId);
  const back = rows.filter((r) => r.qty < 0);
  if (!back.length) return;
  await tx.insert(stockMoves).values(back.map((r) => ({ tenantId, stockItemId: r.stockItemId, kind: "void" as const, qty: -r.qty, orderId, staffId })));
}

export interface StockLinkView {
  id: string;
  itemId: string | null;
  itemNameAr: string | null;
  categoryKind: CategoryKind | null;
  sizeKey: string | null;
  qty: number;
  takeawayOnly: boolean;
}

export interface StockRow {
  id: string;
  nameAr: string;
  unit: StockUnit;
  active: boolean;
  /** What should be on the shelf: the sum of every move. */
  level: number;
  /** Since the business day opened, and over the last 7 days. Used and wasted are positive. */
  today: { in: number; used: number; wasted: number };
  week: { in: number; used: number; wasted: number };
  lastCount: { at: string; counted: number; difference: number; staffName: string } | null;
  links: StockLinkView[];
}

/** Basic inventory (docs/milestones/m9-basic-inventory.md): stock items, deliveries, counts and waste. */
export function createInventoryStore(db: Db, tenantId: string, days: DayStore, audit: AuditLog) {
  async function item(tx: Tx | Db, id: string, lock = false) {
    if (!UUID.test(id)) throw new StockRefused("not_found");
    const q = tx
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.id, id), eq(stockItems.tenantId, tenantId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new StockRefused("not_found");
    return row;
  }

  async function level(tx: Tx | Db, id: string) {
    const [row] = await tx
      .select({ n: sql<number>`coalesce(sum(${stockMoves.qty}), 0)::int` })
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, tenantId), eq(stockMoves.stockItemId, id)));
    return row?.n ?? 0;
  }

  /** A delivery, count or waste on an active stock item; locked so two tablets take turns. */
  async function move(id: string, staffId: string, build: (current: number) => Omit<typeof stockMoves.$inferInsert, "tenantId" | "stockItemId" | "staffId">) {
    return db.transaction(async (tx) => {
      const row = await item(tx, id, true);
      if (!row.active) throw new StockRefused("inactive");
      const values = build(await level(tx, id));
      await tx.insert(stockMoves).values({ ...values, tenantId, stockItemId: id, staffId });
      return { level: await level(tx, id) };
    });
  }

  const positive = (qty: number) => {
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new StockRefused("bad_qty");
    return qty;
  };

  return {
    /** Every stock item with its level, today's and the week's movement, the last count and its links. */
    async report(): Promise<StockRow[]> {
      const openedAt = await db.transaction(async (tx) => (await days.ensureOpen(tx)).openedAt);
      const items = await db
        .select()
        .from(stockItems)
        .where(eq(stockItems.tenantId, tenantId))
        .orderBy(sql`${stockItems.active} desc`, asc(stockItems.nameAr));
      // Used counts sales less what voids gave back.
      const sum = (kinds: "in" | "used" | "wasted", since: ReturnType<typeof sql>) => {
        const kind = kinds === "in" ? sql`('delivery')` : kinds === "used" ? sql`('sale', 'void')` : sql`('waste')`;
        return sql<number>`coalesce(sum(${stockMoves.qty}) filter (where ${stockMoves.kind} in ${kind} and ${stockMoves.createdAt} >= ${since}), 0)::int`;
      };
      const today = sql`${openedAt.toISOString()}::timestamptz`;
      const week = sql`now() - interval '7 days'`;
      const totals = await db
        .select({
          id: stockMoves.stockItemId,
          level: sql<number>`coalesce(sum(${stockMoves.qty}), 0)::int`,
          todayIn: sum("in", today),
          todayUsed: sum("used", today),
          todayWasted: sum("wasted", today),
          weekIn: sum("in", week),
          weekUsed: sum("used", week),
          weekWasted: sum("wasted", week),
        })
        .from(stockMoves)
        .where(eq(stockMoves.tenantId, tenantId))
        .groupBy(stockMoves.stockItemId);
      const byItem = new Map(totals.map((t) => [t.id, t]));
      const counts = await db
        .selectDistinctOn([stockMoves.stockItemId], {
          id: stockMoves.stockItemId,
          at: stockMoves.createdAt,
          qty: stockMoves.qty,
          data: stockMoves.data,
          staffName: staff.name,
        })
        .from(stockMoves)
        .innerJoin(staff, eq(staff.id, stockMoves.staffId))
        .where(and(eq(stockMoves.tenantId, tenantId), eq(stockMoves.kind, "count")))
        .orderBy(stockMoves.stockItemId, desc(stockMoves.createdAt));
      const lastCount = new Map(counts.map((c) => [c.id, c]));
      const links = await db
        .select({ link: stockLinks, itemNameAr: menuItems.nameAr })
        .from(stockLinks)
        .leftJoin(menuItems, eq(menuItems.id, stockLinks.itemId))
        .where(eq(stockLinks.tenantId, tenantId))
        .orderBy(asc(stockLinks.createdAt));

      return items.map((i) => {
        const t = byItem.get(i.id);
        const c = lastCount.get(i.id);
        return {
          id: i.id,
          nameAr: i.nameAr,
          unit: i.unit,
          active: i.active,
          level: t?.level ?? 0,
          // Out-moves are negative; 0 − n keeps a zero from showing as −0.
          today: { in: t?.todayIn ?? 0, used: 0 - (t?.todayUsed ?? 0), wasted: 0 - (t?.todayWasted ?? 0) },
          week: { in: t?.weekIn ?? 0, used: 0 - (t?.weekUsed ?? 0), wasted: 0 - (t?.weekWasted ?? 0) },
          lastCount: c ? { at: c.at.toISOString(), counted: (c.data as { counted?: number }).counted ?? 0, difference: c.qty, staffName: c.staffName } : null,
          links: links
            .filter((l) => l.link.stockItemId === i.id)
            .map(({ link: l, itemNameAr }) => ({
              id: l.id,
              itemId: l.itemId,
              itemNameAr,
              categoryKind: l.categoryKind,
              sizeKey: l.sizeKey,
              qty: l.qty,
              takeawayOnly: l.takeawayOnly,
            })),
        };
      });
    },

    /** The last moves of one stock item, newest first, with who made them. */
    async moves(id: string) {
      await item(db, id);
      const rows = await db
        .select({ move: stockMoves, staffName: staff.name })
        .from(stockMoves)
        .innerJoin(staff, eq(staff.id, stockMoves.staffId))
        .where(and(eq(stockMoves.tenantId, tenantId), eq(stockMoves.stockItemId, id)))
        .orderBy(desc(stockMoves.createdAt), desc(stockMoves.id))
        .limit(200);
      return rows.map(({ move: m, staffName }) => ({
        id: m.id,
        kind: m.kind,
        qty: m.qty,
        costCents: m.costCents,
        supplier: m.supplier,
        note: m.note,
        orderId: m.orderId,
        staffName,
        createdAt: m.createdAt.toISOString(),
      }));
    },

    delivery(id: string, qty: number, costPounds: number | null, supplier: string, staffId: string) {
      return move(id, staffId, () => ({ kind: "delivery", qty: positive(qty), costCents: costPounds === null ? null : costPounds * 100, supplier }));
    },

    /** What is really on the shelf. The move holds the difference, so the level becomes the count. */
    count(id: string, counted: number, staffId: string) {
      if (!Number.isSafeInteger(counted) || counted < 0) throw new StockRefused("bad_qty");
      return move(id, staffId, (current) => ({ kind: "count", qty: counted - current, data: { counted, expected: current } }));
    },

    waste(id: string, qty: number, note: string, staffId: string) {
      return move(id, staffId, () => ({ kind: "waste", qty: -positive(qty), note }));
    },

    async addItem(input: { nameAr: string; unit: StockUnit }, staffId: string) {
      const [row] = await db
        .insert(stockItems)
        .values({ tenantId, ...input })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new StockRefused("duplicate");
      await audit.record(staffId, "stock_item_added", { id: row.id, ...input });
      return row.id;
    },

    async updateItem(id: string, patch: { nameAr?: string; active?: boolean }, staffId: string) {
      if (!UUID.test(id)) return false;
      if (patch.nameAr !== undefined) {
        const [same] = await db
          .select({ id: stockItems.id })
          .from(stockItems)
          .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.nameAr, patch.nameAr)));
        if (same && same.id !== id) throw new StockRefused("duplicate");
      }
      const rows = await db
        .update(stockItems)
        .set(patch)
        .where(and(eq(stockItems.id, id), eq(stockItems.tenantId, tenantId)))
        .returning();
      if (!rows.length) return false;
      await audit.record(staffId, "stock_item_changed", { id, ...patch });
      return true;
    },

    /** Links a stock item to a menu item (and size), or to every pizza or calzone. */
    async addLink(
      input: {
        stockItemId: string;
        itemId?: string | null | undefined;
        categoryKind?: CategoryKind | null | undefined;
        sizeKey?: string | null | undefined;
        qty: number;
        takeawayOnly?: boolean | undefined;
      },
      staffId: string,
    ) {
      await item(db, input.stockItemId);
      const itemId = input.itemId ?? null;
      const kind = input.categoryKind ?? null;
      if ((itemId === null) === (kind === null)) throw new StockRefused("bad_link");
      if (itemId !== null) {
        if (!UUID.test(itemId)) throw new StockRefused("bad_link");
        const [menuItem] = await db
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, tenantId)));
        if (!menuItem) throw new StockRefused("bad_link");
      }
      const values = {
        stockItemId: input.stockItemId,
        itemId,
        categoryKind: kind,
        sizeKey: input.sizeKey ?? null,
        qty: positive(input.qty),
        takeawayOnly: input.takeawayOnly ?? false,
      };
      const [row] = await db
        .insert(stockLinks)
        .values({ tenantId, ...values })
        .returning();
      await audit.record(staffId, "stock_link_added", { id: row!.id, ...values });
      return row!.id;
    },

    /** Links are setup, not history: removing one only changes future sales. */
    async removeLink(id: string, staffId: string) {
      if (!UUID.test(id)) return false;
      const rows = await db
        .delete(stockLinks)
        .where(and(eq(stockLinks.id, id), eq(stockLinks.tenantId, tenantId)))
        .returning();
      if (!rows.length) return false;
      await audit.record(staffId, "stock_link_removed", { id, stockItemId: rows[0]!.stockItemId });
      return true;
    },

    /**
     * The starting list (Mahmoud, 2026-10-18: drinks and boxes): each drink size
     * on the menu, linked to its menu item, and a box per pizza and calzone size
     * for pickup and delivery. Only when the restaurant has no stock items yet.
     */
    async ensureStarter() {
      const [any] = await db.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.tenantId, tenantId)).limit(1);
      if (any) return;
      await db.transaction(async (tx) => {
        const add = async (nameAr: string, unit: StockUnit) => {
          const [row] = await tx.insert(stockItems).values({ tenantId, nameAr, unit }).onConflictDoNothing().returning();
          return row?.id;
        };
        const link = (values: Omit<typeof stockLinks.$inferInsert, "tenantId">) => tx.insert(stockLinks).values({ tenantId, ...values });

        const drinks = await tx
          .select({ id: menuItems.id, nameAr: menuItems.nameAr })
          .from(menuItems)
          .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
          .where(and(eq(menuItems.tenantId, tenantId), eq(menuCategories.key, "drinks")))
          .orderBy(asc(menuItems.sort));
        for (const drink of drinks) {
          const sizes = await tx
            .select({ sizeKey: itemSizes.sizeKey, nameAr: itemSizes.nameAr })
            .from(itemSizes)
            .where(and(eq(itemSizes.itemId, drink.id), eq(itemSizes.tenantId, tenantId)))
            .orderBy(asc(itemSizes.sort));
          for (const size of sizes) {
            const id = await add(sizes.length > 1 ? `${drink.nameAr} · ${size.nameAr}` : drink.nameAr, "piece");
            if (id) await link({ stockItemId: id, itemId: drink.id, sizeKey: size.sizeKey, qty: 1 });
          }
        }
        const small = await add("علبة بيتزا وسط", "piece");
        const big = await add("علبة بيتزا كبير", "piece");
        if (small) {
          await link({ stockItemId: small, categoryKind: "pizza", sizeKey: "regular", qty: 1, takeawayOnly: true });
          await link({ stockItemId: small, categoryKind: "calzone", qty: 1, takeawayOnly: true });
        }
        if (big) await link({ stockItemId: big, categoryKind: "pizza", sizeKey: "large", qty: 1, takeawayOnly: true });
      });
    },
  };
}

export type InventoryStore = ReturnType<typeof createInventoryStore>;

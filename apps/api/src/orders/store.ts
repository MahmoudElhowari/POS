import { and, desc, eq, like, sql } from "drizzle-orm";
import { customers, type Db, heldOrders, orderEvents, orderLines, orders } from "@pos/db";
import { type DraftProblem, headerProblems, type OrderDraft, priceDraft } from "@pos/shared";
import type { MenuStore } from "../menu/store.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Why an order could not be sent; the order screen shows each one. */
export class OrderRefused extends Error {
  constructor(
    readonly code: "invalid" | "price_changed" | "not_held",
    readonly detail: { problems?: DraftProblem[]; totalCents?: number } = {},
  ) {
    super(code);
  }
}

export interface HeldOrder {
  id: string;
  draft: OrderDraft;
  staffId: string;
  updatedAt: string;
}

export interface SentOrder {
  id: string;
  number: number;
  businessDate: string;
  totalCents: number;
}

export interface CustomerMatch {
  id: string;
  name: string;
  phone: string;
  area: string;
  directions: string;
}

const cleanPhone = (phone: string | undefined) => (phone ? phone.replace(/\s+/g, "") : undefined);

/**
 * Orders for one restaurant. Held orders are editable drafts; a sent order is
 * written once (order, lines, a "sent" event) and never updated.
 */
export function createOrderStore(db: Db, tenantId: string, menu: MenuStore, timeZone: string) {
  /** Saves the customer by phone so the next order can find them. Returns their id. */
  async function rememberCustomer(tx: Tx, draft: OrderDraft): Promise<string | null> {
    const phone = cleanPhone(draft.customer.phone);
    if (!phone) return null;
    const fields = {
      name: draft.customer.name.trim(),
      ...(draft.customer.area ? { area: draft.customer.area } : {}),
      ...(draft.customer.directions ? { directions: draft.customer.directions } : {}),
    };
    const [row] = await tx
      .insert(customers)
      .values({ tenantId, phone, ...fields })
      .onConflictDoUpdate({
        target: [customers.tenantId, customers.phone],
        targetWhere: sql`${customers.phone} is not null`,
        set: { ...fields, updatedAt: sql`now()` },
      })
      .returning({ id: customers.id });
    return row!.id;
  }

  return {
    async hold(draft: OrderDraft, staffId: string, heldId?: string): Promise<string> {
      const problems = headerProblems(draft);
      if (problems.length) throw new OrderRefused("invalid", { problems });
      if (heldId) {
        const [row] = await db
          .update(heldOrders)
          .set({ draft, staffId, updatedAt: sql`now()` })
          .where(and(eq(heldOrders.id, heldId), eq(heldOrders.tenantId, tenantId)))
          .returning({ id: heldOrders.id });
        if (!row) throw new OrderRefused("not_held");
        return row.id;
      }
      const [row] = await db.insert(heldOrders).values({ tenantId, staffId, draft }).returning({ id: heldOrders.id });
      return row!.id;
    },

    async held(): Promise<HeldOrder[]> {
      const rows = await db.select().from(heldOrders).where(eq(heldOrders.tenantId, tenantId)).orderBy(desc(heldOrders.updatedAt));
      return rows.map((r) => ({ id: r.id, draft: r.draft as OrderDraft, staffId: r.staffId, updatedAt: r.updatedAt.toISOString() }));
    },

    /** Throws away a held order (it was never sent, so nothing is lost from history). */
    async discardHeld(heldId: string): Promise<boolean> {
      const rows = await db
        .delete(heldOrders)
        .where(and(eq(heldOrders.id, heldId), eq(heldOrders.tenantId, tenantId)))
        .returning({ id: heldOrders.id });
      return rows.length > 0;
    },

    /**
     * Re-prices the order on the server with today's menu, refuses it if the
     * cashier saw a different total, then writes it with the next daily number.
     */
    async send(draft: OrderDraft, staffId: string, expectedTotalCents: number, heldId?: string): Promise<SentOrder> {
      const header = headerProblems(draft);
      if (header.length) throw new OrderRefused("invalid", { problems: header });
      const sellable = await menu.publicMenu();
      const { priced, problems } = priceDraft(draft, sellable);
      if (!priced) throw new OrderRefused("invalid", { problems });
      if (priced.totalCents !== expectedTotalCents) throw new OrderRefused("price_changed", { totalCents: priced.totalCents });

      const items = new Map(sellable.categories.flatMap((c) => c.items.map((i) => [i.id, i] as const)));
      const addonNames = new Map(sellable.addons.map((a) => [a.key, a] as const));

      return db.transaction(async (tx) => {
        if (heldId) {
          const gone = await tx
            .delete(heldOrders)
            .where(and(eq(heldOrders.id, heldId), eq(heldOrders.tenantId, tenantId)))
            .returning({ id: heldOrders.id });
          // Already sent from another tablet, or discarded.
          if (!gone.length) throw new OrderRefused("not_held");
        }
        const customerId = await rememberCustomer(tx, draft);

        // One sender at a time per restaurant, so daily numbers never clash.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`orders:${tenantId}`}))`);
        const today = sql`(now() at time zone ${timeZone})::date`;
        const [next] = await tx
          .select({ n: sql<number>`coalesce(max(${orders.number}), 0)::int + 1`, day: sql<string>`${today}::text` })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.businessDate, today)));

        const [order] = await tx
          .insert(orders)
          .values({
            tenantId,
            businessDate: next!.day,
            number: next!.n,
            type: draft.type,
            tableNo: draft.type === "dine_in" ? (draft.tableNo ?? null) : null,
            customerId,
            customerName: draft.customer.name.trim(),
            customerPhone: cleanPhone(draft.customer.phone) ?? null,
            deliveryArea: draft.type === "delivery" ? (draft.customer.area ?? "") : "",
            deliveryDirections: draft.type === "delivery" ? (draft.customer.directions ?? "") : "",
            note: draft.note ?? "",
            totalCents: priced.totalCents,
            staffId,
          })
          .returning();

        await tx.insert(orderLines).values(
          priced.lines.map((p, i) => {
            const item = items.get(p.line.itemId)!;
            const size = item.sizes.find((s) => s.sizeKey === p.line.sizeKey)!;
            const other = p.line.otherHalfId ? items.get(p.line.otherHalfId) : undefined;
            const removable = [...item.removable, ...(other?.removable ?? [])];
            return {
              tenantId,
              orderId: order!.id,
              lineNo: i + 1,
              itemId: item.id,
              nameAr: item.nameAr,
              nameEn: item.nameEn,
              sizeKey: size.sizeKey,
              sizeNameAr: size.nameAr,
              sizeNameEn: size.nameEn,
              otherHalfId: other?.id ?? null,
              otherHalfNameAr: other?.nameAr ?? null,
              otherHalfNameEn: other?.nameEn ?? null,
              addons: p.parts
                .filter((part) => part.kind === "addon")
                .map((part) => {
                  const addon = addonNames.get(part.key)!;
                  return { key: part.key, nameAr: addon.nameAr, nameEn: addon.nameEn, cents: part.cents };
                }),
              removals: p.removals.map((ar) => removable.find((r) => r.ar === ar) ?? { ar, en: "" }),
              note: p.line.note ?? "",
              qty: p.qty,
              unitCents: p.unitCents,
              totalCents: p.totalCents,
            };
          }),
        );
        await tx.insert(orderEvents).values({ tenantId, orderId: order!.id, kind: "sent", staffId });
        return { id: order!.id, number: order!.number, businessDate: order!.businessDate, totalCents: order!.totalCents };
      });
    },

    async get(id: string) {
      const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.tenantId, tenantId)));
      if (!order) return null;
      const lines = await db
        .select()
        .from(orderLines)
        .where(and(eq(orderLines.orderId, id), eq(orderLines.tenantId, tenantId)))
        .orderBy(orderLines.lineNo);
      return { ...order, lines };
    },

    /** Customers whose phone starts with these digits (at least 3), newest first. */
    async findCustomers(phonePrefix: string): Promise<CustomerMatch[]> {
      const digits = phonePrefix.replace(/[^0-9+]/g, "");
      if (digits.length < 3) return [];
      const rows = await db
        .select({ id: customers.id, name: customers.name, phone: customers.phone, area: customers.area, directions: customers.directions })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), like(customers.phone, `${digits}%`)))
        .orderBy(desc(customers.updatedAt))
        .limit(5);
      return rows.map((r) => ({ ...r, phone: r.phone ?? "" }));
    },
  };
}

export type OrderStore = ReturnType<typeof createOrderStore>;

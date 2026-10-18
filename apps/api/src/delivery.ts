import { and, asc, eq, sql } from "drizzle-orm";
import { type Db, drivers, orderEvents, orders } from "@pos/db";
import { type DeliveryStatus, deliveryStatus, type DriverRef, type DriverRow, type OrderTotals, orderTotals, type Tender } from "@pos/shared";
import type { AuditLog } from "./audit.js";
import { type DayStore, toMoneyEvent, type Tx } from "./days.js";
import type { MoneyStore } from "./orders/money.js";

/** Why a delivery action was refused; the board shows each one. */
export class DeliveryRefused extends Error {
  constructor(readonly code: "not_found" | "not_delivery" | "voided" | "not_waiting" | "not_out" | "no_driver" | "duplicate") {
    super(code);
  }
}

export interface BoardOrder {
  id: string;
  number: number;
  customerName: string;
  phone: string | null;
  area: string;
  directions: string;
  sentAt: string;
  /** From an earlier day. */
  carried: boolean;
  totals: OrderTotals;
  delivery: DeliveryStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The delivery board (docs/milestones/m7-delivery-board.md): drivers take
 * delivery orders out and bring back the cash. Each step is an order event.
 */
export function createDeliveryStore(db: Db, tenantId: string, days: DayStore, money: MoneyStore, audit: AuditLog) {
  async function driver(tx: Tx | Db, driverId: string): Promise<DriverRef> {
    if (!UUID.test(driverId)) throw new DeliveryRefused("no_driver");
    const [row] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.tenantId, tenantId)));
    if (!row || !row.active) throw new DeliveryRefused("no_driver");
    return { driverId: row.id, driverName: row.name };
  }

  /** A delivery order and where it is, locked so two tablets take turns. */
  async function load(tx: Tx, orderId: string) {
    if (!UUID.test(orderId)) throw new DeliveryRefused("not_found");
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .for("update");
    if (!order) throw new DeliveryRefused("not_found");
    if (order.type !== "delivery") throw new DeliveryRefused("not_delivery");
    const events = await tx
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.tenantId, tenantId)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    const totals = orderTotals(order.totalCents, events.map(toMoneyEvent).filter((e) => e !== null), order.taxRateBp);
    if (totals.status === "voided" || totals.status === "refunded") throw new DeliveryRefused("voided");
    return { order, totals, delivery: deliveryStatus(events) };
  }

  return {
    /** Today's delivery orders and where each one is, plus the drivers to pick from and today's driver totals. */
    async board(): Promise<{ orders: BoardOrder[]; drivers: { id: string; name: string }[]; summary: DriverRow[] }> {
      const list = (await days.today()).filter((d) => d.order.type === "delivery" && d.totals.status !== "voided" && d.totals.status !== "refunded");
      const boardOrders = list
        .map(({ order: o, totals, carried, events }) => ({
          id: o.id,
          number: o.number,
          customerName: o.customerName,
          phone: o.customerPhone,
          area: o.deliveryArea,
          directions: o.deliveryDirections,
          sentAt: o.sentAt.toISOString(),
          carried,
          totals,
          delivery: deliveryStatus(events),
        }))
        // Oldest first: the one waiting longest goes out first.
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      const active = await db
        .select({ id: drivers.id, name: drivers.name })
        .from(drivers)
        .where(and(eq(drivers.tenantId, tenantId), eq(drivers.active, true)))
        .orderBy(asc(drivers.name));
      return { orders: boardOrders, drivers: active, summary: (await days.x()).report.drivers };
    },

    /** One driver takes one or more waiting orders out. */
    async out(orderIds: string[], driverId: string, staffId: string) {
      if (new Set(orderIds).size !== orderIds.length) throw new DeliveryRefused("duplicate");
      await db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const who = await driver(tx, driverId);
        for (const orderId of orderIds) {
          const { delivery } = await load(tx, orderId);
          if (delivery.state !== "waiting") throw new DeliveryRefused("not_waiting");
          await tx.insert(orderEvents).values({ tenantId, orderId, kind: "out_for_delivery", staffId, data: who, dayId: day.id });
        }
      });
    },

    /**
     * The driver is back: the order was delivered. What the customer paid, in
     * cash to the driver or by wallet, is taken in the same step. The driver keeps the delivery fee, which the
     * event carries so the Z takes it out of the drawer.
     */
    async delivered(orderId: string, tender: Tender | null, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { delivery, totals } = await load(tx, orderId);
        if (delivery.state !== "out" || !delivery.driverId) throw new DeliveryRefused("not_out");
        const who: DriverRef = { driverId: delivery.driverId, driverName: delivery.driverName ?? "" };
        const paid = tender ? await money.take(tx, day.id, orderId, tender, staffId, who) : null;
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "delivered", staffId, amountCents: totals.deliveryFeeCents, data: who, dayId: day.id });
        return { totals: paid?.totals ?? totals, changeCents: paid?.changeCents ?? 0 };
      });
    },

    /** The driver brought the order back undelivered; it waits for a driver again. */
    async returned(orderId: string, note: string, staffId: string) {
      await db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { delivery } = await load(tx, orderId);
        if (delivery.state !== "out" || !delivery.driverId) throw new DeliveryRefused("not_out");
        const who: DriverRef = { driverId: delivery.driverId, driverName: delivery.driverName ?? "" };
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "returned", staffId, note, data: who, dayId: day.id });
      });
    },

    async drivers() {
      return db.select().from(drivers).where(eq(drivers.tenantId, tenantId)).orderBy(sql`${drivers.active} desc`, asc(drivers.name));
    },

    async addDriver(name: string, staffId: string) {
      const [row] = await db.insert(drivers).values({ tenantId, name }).onConflictDoNothing().returning();
      if (!row) throw new DeliveryRefused("duplicate");
      await audit.record(staffId, "driver_added", { id: row.id, name });
      return row.id;
    },

    async updateDriver(id: string, patch: { name?: string; active?: boolean }, staffId: string) {
      if (!UUID.test(id)) return false;
      if (patch.name !== undefined) {
        const [same] = await db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.tenantId, tenantId), eq(drivers.name, patch.name)));
        if (same && same.id !== id) throw new DeliveryRefused("duplicate");
      }
      const rows = await db
        .update(drivers)
        .set(patch)
        .where(and(eq(drivers.id, id), eq(drivers.tenantId, tenantId)))
        .returning();
      if (!rows.length) return false;
      await audit.record(staffId, "driver_changed", { id, ...patch });
      return true;
    },
  };
}

export type DeliveryStore = ReturnType<typeof createDeliveryStore>;


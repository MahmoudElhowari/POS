import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Db, type Order, orderEvents, orderLines, orders, payments, printJobs, staff } from "@pos/db";
import { cashTender, type OrderTotals, orderTotals, percentOf } from "@pos/shared";
import { type DayStore, toMoneyEvent } from "../days.js";
import type { SettingsStore } from "../settings.js";
import { customerReceipt, kitchenTicket } from "./tickets.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const VOID_REASONS = ["customer_cancelled", "wrong_order", "other"] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** Why a money action was refused; the screen shows each one. */
export class MoneyRefused extends Error {
  constructor(
    readonly code: "not_found" | "voided" | "refunded" | "paid" | "has_payments" | "not_paid" | "not_delivery" | "too_much" | "bad_amount",
  ) {
    super(code);
  }
}

export interface OrderSummary {
  id: string;
  number: number;
  type: Order["type"];
  tableNo: number | null;
  customerName: string;
  sentAt: string;
  businessDate: string;
  /** An unpaid delivery from an earlier day. */
  carried: boolean;
  totals: OrderTotals;
}

export interface OrderEventView {
  id: string;
  kind: string;
  amountCents: number | null;
  staffName: string;
  approvedByName: string | null;
  reason: string | null;
  note: string;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payments, discounts, delivery fees, voids and refunds for one restaurant.
 * Each is a new order_events row; orders and lines are never changed.
 */
export function createMoneyStore(db: Db, tenantId: string, days: DayStore, settings: SettingsStore) {
  async function load(tx: Tx | Db, orderId: string, lock = false) {
    if (!UUID.test(orderId)) throw new MoneyRefused("not_found");
    const q = tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    // Two tablets paying the same order at once take turns.
    const [order] = lock ? await q.for("update") : await q;
    if (!order) throw new MoneyRefused("not_found");
    const events = await tx
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.tenantId, tenantId)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    const totals = orderTotals(order.totalCents, events.map(toMoneyEvent).filter((e) => e !== null), order.taxRateBp);
    return { order, events, totals };
  }

  async function lines(tx: Tx | Db, orderId: string) {
    return tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.orderId, orderId), eq(orderLines.tenantId, tenantId)))
      .orderBy(asc(orderLines.lineNo));
  }

  async function staffName(tx: Tx | Db, staffId: string) {
    const [row] = await tx.select({ name: staff.name }).from(staff).where(and(eq(staff.id, staffId), eq(staff.tenantId, tenantId)));
    return row?.name ?? "";
  }

  async function queue(tx: Tx | Db, printer: "receipt" | "kitchen", kind: "receipt" | "kitchen", payload: object) {
    await tx.insert(printJobs).values({ tenantId, printer, kind, payload });
    await tx.execute(sql`select pg_notify('print_jobs', ${tenantId})`);
  }

  async function queueReceipt(tx: Tx | Db, orderId: string, reprint: boolean) {
    const { order, totals } = await load(tx, orderId);
    const [last] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    const payload = customerReceipt(order, await lines(tx, orderId), totals, {
      cashierName: await staffName(tx, order.staffId),
      tenderedCents: last?.tenderedCents ?? 0,
      changeCents: last?.changeCents ?? 0,
      reprint,
      settings: await settings.all(),
    });
    await queue(tx, "receipt", "receipt", payload);
  }

  /**
   * Records cash inside the caller's transaction, on the given day. `data` adds
   * to the event (the driver who collected it, for a delivery).
   */
  async function cashIn(tx: Tx, dayId: string, orderId: string, tenderedPounds: number, staffId: string, data: object = {}) {
    const { totals } = await load(tx, orderId, true);
    if (totals.status === "voided") throw new MoneyRefused("voided");
    if (totals.status === "refunded") throw new MoneyRefused("refunded");
    if (totals.balanceCents <= 0) throw new MoneyRefused("paid");
    if (!Number.isSafeInteger(tenderedPounds) || tenderedPounds <= 0) throw new MoneyRefused("bad_amount");
    const { appliedCents, changeCents } = cashTender(totals.balanceCents, tenderedPounds * 100);
    const [event] = await tx
      .insert(orderEvents)
      .values({ tenantId, orderId, kind: "payment", staffId, amountCents: appliedCents, data: { ...data, method: "cash" }, dayId })
      .returning();
    await tx.insert(payments).values({
      tenantId,
      orderId,
      eventId: event!.id,
      method: "cash",
      amountCents: appliedCents,
      tenderedCents: tenderedPounds * 100,
      changeCents,
    });
    const after = (await load(tx, orderId)).totals;
    if (after.status === "paid") await queueReceipt(tx, orderId, false);
    return { totals: after, changeCents };
  }

  /** Discounts and fees only change an order nobody has paid towards yet. */
  function assertOpen(totals: OrderTotals) {
    if (totals.status === "voided") throw new MoneyRefused("voided");
    if (totals.status === "refunded") throw new MoneyRefused("refunded");
    if (totals.paidCents > 0) throw new MoneyRefused("has_payments");
  }

  return {
    /** The open day's orders, newest first, then deliveries carried over from earlier days. */
    async today(): Promise<OrderSummary[]> {
      return (await days.today()).map(({ order: o, totals, carried }) => ({
        id: o.id,
        number: o.number,
        type: o.type,
        tableNo: o.tableNo,
        customerName: o.customerName,
        sentAt: o.sentAt.toISOString(),
        businessDate: o.businessDate,
        carried,
        totals,
      }));
    },

    /** One order with its lines, history and totals. */
    async detail(orderId: string) {
      const { order, events, totals } = await load(db, orderId);
      const names = new Map((await db.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.tenantId, tenantId))).map((s) => [s.id, s.name]));
      const history: OrderEventView[] = events.map((e) => ({
        id: e.id,
        kind: e.kind,
        amountCents: e.amountCents,
        staffName: names.get(e.staffId) ?? "",
        approvedByName: e.approvedBy ? (names.get(e.approvedBy) ?? "") : null,
        reason: e.reason,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      }));
      const taxNameAr = (await settings.get("tax")).nameAr;
      return { ...order, sentAt: order.sentAt.toISOString(), lines: await lines(db, orderId), history, totals, taxNameAr };
    },

    async discount(orderId: string, input: { percentBp?: number; amountPounds?: number }, staffId: string, approvedBy: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { totals } = await load(tx, orderId, true);
        assertOpen(totals);
        const amount = input.percentBp !== undefined ? percentOf(totals.subtotalCents, input.percentBp) : (input.amountPounds ?? 0) * 100;
        if (!Number.isSafeInteger(amount) || amount < 0) throw new MoneyRefused("bad_amount");
        if (amount > totals.subtotalCents) throw new MoneyRefused("too_much");
        await tx.insert(orderEvents).values({
          tenantId,
          orderId,
          kind: "discount",
          staffId,
          dayId: day.id,
          approvedBy,
          amountCents: amount,
          // "coupon" is reserved for coupon codes later.
          data: { source: "manual", ...(input.percentBp !== undefined ? { percentBp: input.percentBp } : { amountPounds: input.amountPounds }) },
        });
        return (await load(tx, orderId)).totals;
      });
    },

    async deliveryFee(orderId: string, amountPounds: number, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { order, totals } = await load(tx, orderId, true);
        if (order.type !== "delivery") throw new MoneyRefused("not_delivery");
        assertOpen(totals);
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "delivery_fee", staffId, amountCents: amountPounds * 100, dayId: day.id });
        return (await load(tx, orderId)).totals;
      });
    },

    /** Cash payment. Prints the receipt once the order is fully paid. */
    async payCash(orderId: string, tenderedPounds: number, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        return cashIn(tx, day.id, orderId, tenderedPounds, staffId);
      });
    },

    cashIn,

    /** Cancels an order nobody has paid for. */
    async void(orderId: string, reason: VoidReason, note: string, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { totals } = await load(tx, orderId, true);
        if (totals.status === "voided") throw new MoneyRefused("voided");
        if (totals.status === "refunded") throw new MoneyRefused("refunded");
        if (totals.paidCents > 0) throw new MoneyRefused("has_payments");
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "void", staffId, reason, note, dayId: day.id });
        return (await load(tx, orderId)).totals;
      });
    },

    /** Gives back everything paid on an order. */
    async refund(orderId: string, reason: VoidReason, note: string, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { totals } = await load(tx, orderId, true);
        if (totals.status === "voided") throw new MoneyRefused("voided");
        if (totals.status === "refunded") throw new MoneyRefused("refunded");
        if (totals.paidCents <= 0) throw new MoneyRefused("not_paid");
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "refund", staffId, amountCents: totals.paidCents, reason, note, dayId: day.id });
        return (await load(tx, orderId)).totals;
      });
    },

    async reprint(orderId: string, which: "kitchen" | "receipt") {
      const { order } = await load(db, orderId);
      if (which === "kitchen") await queue(db, "kitchen", "kitchen", kitchenTicket(order, await lines(db, orderId), true));
      else await queueReceipt(db, orderId, true);
    },
  };
}

export type MoneyStore = ReturnType<typeof createMoneyStore>;

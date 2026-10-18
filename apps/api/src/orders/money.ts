import { and, asc, eq, sql } from "drizzle-orm";
import { type Db, coupons, type Order, orderEvents, orderLines, orders, payments, printJobs, staff } from "@pos/db";
import { cashTender, couponAmount, couponCode, couponOf, couponRefusal, type OrderTotals, orderTotals, paymentOf, percentOf, type Tender } from "@pos/shared";
import { type DayStore, toMoneyEvent } from "../days.js";
import { returnStock } from "../inventory.js";
import type { SettingsStore } from "../settings.js";
import { customerReceipt, kitchenTicket } from "./tickets.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const VOID_REASONS = ["customer_cancelled", "wrong_order", "other"] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** Why a money action was refused; the screen shows each one. */
export class MoneyRefused extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "voided"
      | "refunded"
      | "paid"
      | "has_payments"
      | "not_paid"
      | "not_delivery"
      | "too_much"
      | "bad_amount"
      | "no_wallet"
      | "no_coupon"
      | "inactive"
      | "expired"
      | "used_up"
      | "over_due",
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
  /** A wallet payment or refund: the wallet and the transfer reference. */
  walletName: string | null;
  reference: string | null;
  /** A discount from a coupon. */
  coupon: string | null;
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
    const { order, events, totals } = await load(tx, orderId);
    const paid = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId)))
      .orderBy(asc(payments.createdAt));
    const walletNames = new Map(events.filter((e) => e.kind === "payment").map((e) => [e.id, paymentOf(e.data).walletName ?? null]));
    const lastCash = paid.filter((p) => p.method === "cash").at(-1);
    const payload = customerReceipt(order, await lines(tx, orderId), totals, {
      cashierName: await staffName(tx, order.staffId),
      tenderedCents: lastCash?.tenderedCents ?? 0,
      changeCents: lastCash?.changeCents ?? 0,
      payments: paid.map((p) => ({
        method: p.method,
        nameAr: p.method === "cash" ? "نقداً" : (walletNames.get(p.eventId) ?? p.wallet ?? ""),
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents,
        changeCents: p.changeCents,
        reference: p.reference,
      })),
      couponCode: couponOf(events.filter((e) => e.kind === "discount").at(-1)?.data)?.code ?? null,
      reprint,
      settings: await settings.all(),
    });
    await queue(tx, "receipt", "receipt", payload);
  }

  /**
   * Takes one payment, cash or wallet, inside the caller's transaction, on the
   * given day. `data` adds to the event (the driver who collected it, for a
   * delivery). Prints the receipt once the order is fully paid.
   */
  async function take(tx: Tx, dayId: string, orderId: string, tender: Tender, staffId: string, data: object = {}) {
    const { totals } = await load(tx, orderId, true);
    if (totals.status === "voided") throw new MoneyRefused("voided");
    if (totals.status === "refunded") throw new MoneyRefused("refunded");
    if (totals.balanceCents <= 0) throw new MoneyRefused("paid");
    let row: { method: "cash" | "wallet"; appliedCents: number; tenderedCents: number; changeCents: number; wallet?: string; reference?: string };
    let ref: object;
    if (tender.method === "cash") {
      if (!Number.isSafeInteger(tender.tenderedPounds) || tender.tenderedPounds <= 0) throw new MoneyRefused("bad_amount");
      const { appliedCents, changeCents } = cashTender(totals.balanceCents, tender.tenderedPounds * 100);
      row = { method: "cash", appliedCents, tenderedCents: tender.tenderedPounds * 100, changeCents };
      ref = { method: "cash" };
    } else {
      const wallet = (await settings.get("wallets")).find((w) => w.key === tender.wallet && w.active);
      if (!wallet) throw new MoneyRefused("no_wallet");
      const amount = tender.amountPounds * 100;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new MoneyRefused("bad_amount");
      // A transfer gives no change, so it can't be more than what is due.
      if (amount > totals.balanceCents) throw new MoneyRefused("over_due");
      row = { method: "wallet", appliedCents: amount, tenderedCents: amount, changeCents: 0, wallet: wallet.key, reference: tender.reference };
      ref = { method: "wallet", wallet: wallet.key, walletName: wallet.nameAr, reference: tender.reference };
    }
    const [event] = await tx
      .insert(orderEvents)
      .values({ tenantId, orderId, kind: "payment", staffId, amountCents: row.appliedCents, data: { ...data, ...ref }, dayId })
      .returning();
    await tx
      .insert(payments)
      .values({
        tenantId,
        orderId,
        eventId: event!.id,
        method: row.method,
        amountCents: row.appliedCents,
        tenderedCents: row.tenderedCents,
        changeCents: row.changeCents,
        wallet: row.wallet ?? null,
        reference: row.reference ?? null,
      });
    const after = (await load(tx, orderId)).totals;
    if (after.status === "paid") await queueReceipt(tx, orderId, false);
    return { totals: after, changeCents: row.changeCents };
  }

  /** Orders other than `exceptOrderId` whose current discount is this coupon, not counting voided ones. */
  async function couponUses(tx: Tx, couponId: string, exceptOrderId: string) {
    const { rows } = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select distinct on (e.order_id) e.order_id, e.data->>'couponId' as coupon_id
        from order_events e
        where e.tenant_id = ${tenantId} and e.kind = 'discount'
          and e.order_id in (select order_id from order_events where tenant_id = ${tenantId} and kind = 'discount' and data->>'couponId' = ${couponId})
        order by e.order_id, e.created_at desc, e.id desc
      ) last
      where last.coupon_id = ${couponId} and last.order_id <> ${exceptOrderId}
        and not exists (select 1 from order_events v where v.tenant_id = ${tenantId} and v.order_id = last.order_id and v.kind = 'void')`);
    return rows[0]?.n ?? 0;
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
        walletName: e.kind === "payment" || e.kind === "refund" ? (paymentOf(e.data).walletName ?? null) : null,
        reference: e.kind === "payment" || e.kind === "refund" ? (paymentOf(e.data).reference ?? null) : null,
        coupon: e.kind === "discount" ? (couponOf(e.data)?.code ?? null) : null,
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
        await tx
          .insert(orderEvents)
          .values({
            tenantId,
            orderId,
            kind: "discount",
            staffId,
            dayId: day.id,
            approvedBy,
            amountCents: amount,
            data: { source: "manual", ...(input.percentBp !== undefined ? { percentBp: input.percentBp } : { amountPounds: input.amountPounds }) },
          });
        return (await load(tx, orderId)).totals;
      });
    },

    /**
     * A coupon the admin made (Milestone 8). It needs no manager PIN, and it
     * replaces any discount already on the order, as a new discount does.
     */
    async coupon(orderId: string, code: string, staffId: string) {
      return db.transaction(async (tx) => {
        // The day lock also makes two tablets take turns over a coupon's last use.
        const day = await days.ensureOpen(tx);
        const { totals } = await load(tx, orderId, true);
        assertOpen(totals);
        const [coupon] = await tx
          .select()
          .from(coupons)
          .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, couponCode(code))));
        if (!coupon) throw new MoneyRefused("no_coupon");
        const refused = couponRefusal(coupon, day.date, await couponUses(tx, coupon.id, orderId));
        if (refused) throw new MoneyRefused(refused);
        const amount = couponAmount(coupon, totals.subtotalCents);
        await tx
          .insert(orderEvents)
          .values({
            tenantId,
            orderId,
            kind: "discount",
            staffId,
            dayId: day.id,
            amountCents: amount,
            data: { source: "coupon", couponId: coupon.id, code: coupon.code },
          });
        return { totals: (await load(tx, orderId)).totals, code: coupon.code, amountCents: amount };
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

    /** One payment, cash or wallet; several make a split payment. Prints the receipt once the order is fully paid. */
    async pay(orderId: string, tender: Tender, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        return take(tx, day.id, orderId, tender, staffId);
      });
    },

    take,

    /** Cancels an order nobody has paid for. */
    async void(orderId: string, reason: VoidReason, note: string, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { totals } = await load(tx, orderId, true);
        if (totals.status === "voided") throw new MoneyRefused("voided");
        if (totals.status === "refunded") throw new MoneyRefused("refunded");
        if (totals.paidCents > 0) throw new MoneyRefused("has_payments");
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "void", staffId, reason, note, dayId: day.id });
        await returnStock(tx, tenantId, orderId, staffId);
        return (await load(tx, orderId)).totals;
      });
    },

    /**
     * Gives back everything paid on an order, the way it was paid: one refund
     * event for the cash and one for each wallet, so only the cash leaves the drawer.
     */
    async refund(orderId: string, reason: VoidReason, note: string, staffId: string) {
      return db.transaction(async (tx) => {
        const day = await days.ensureOpen(tx);
        const { events, totals } = await load(tx, orderId, true);
        if (totals.status === "voided") throw new MoneyRefused("voided");
        if (totals.status === "refunded") throw new MoneyRefused("refunded");
        if (totals.paidCents <= 0) throw new MoneyRefused("not_paid");
        const ways = new Map<string, { ref: object; cents: number }>();
        for (const e of events) {
          if (e.kind !== "payment" && e.kind !== "refund") continue;
          const p = paymentOf(e.data);
          const key = p.method === "wallet" ? `wallet:${p.wallet}` : "cash";
          const ref = p.method === "wallet" ? { method: "wallet", wallet: p.wallet, walletName: p.walletName } : { method: "cash" };
          const way = ways.get(key) ?? { ref, cents: 0 };
          way.cents += (e.kind === "payment" ? 1 : -1) * (e.amountCents ?? 0);
          ways.set(key, way);
        }
        for (const { ref, cents } of ways.values()) {
          if (cents <= 0) continue;
          await tx.insert(orderEvents).values({ tenantId, orderId, kind: "refund", staffId, amountCents: cents, reason, note, data: ref, dayId: day.id });
        }
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

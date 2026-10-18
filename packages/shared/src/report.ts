import type { OrderType } from "./order.js";
import { ORDER_TYPES } from "./order.js";
import type { OrderTotals } from "./totals.js";

// The X and Z reports (docs/milestones/m5-close-the-day.md). Sales count on
// the day an order was sent; payments, refunds and voids count on the day
// they happened, so a carried-over delivery paid tomorrow is tomorrow's cash.

export interface ReportOrder {
  id: string;
  number: number;
  type: OrderType;
  customerName: string;
  totals: OrderTotals;
  /** Sent during this day (false for a delivery carried over from an earlier day). */
  sentToday: boolean;
  /** The manager who approved the order's current discount. */
  discountApprovedBy: string | null;
  /** A manager left it unpaid when a day closed. */
  leftUnpaidBy: string | null;
  lines: { qty: number; nameAr: string; sizeAr: string | null; otherHalfAr: string | null }[];
}

/**
 * Money events that happened during this day. "delivered" carries the delivery
 * fee the driver keeps; a payment the driver collected carries the driver.
 */
export interface ReportEvent {
  orderId: string;
  number: number;
  kind: "payment" | "refund" | "void" | "delivered";
  amountCents: number;
  staffName: string;
  reason: string | null;
  driverName?: string | null;
}

export interface DriverRow {
  name: string;
  /** Orders delivered today. */
  orders: number;
  /** Cash the driver collected at the door. */
  collectedCents: number;
  /** Delivery fees the driver keeps. */
  feesCents: number;
  /** What the driver hands in: collected minus fees. Negative means the drawer pays the driver. */
  handInCents: number;
}

export interface DayReport {
  ordersCount: number;
  grossCents: number;
  discountCents: number;
  /** Delivery fees on today's orders. They belong to the drivers, not the restaurant. */
  deliveryFeeCents: number;
  /** Food sales after discounts: the restaurant's sales. */
  netCents: number;
  taxIncludedCents: number;
  byType: { type: OrderType; count: number; netCents: number }[];
  cashCents: number;
  cashCount: number;
  refundCents: number;
  refundCount: number;
  voids: { number: number; reason: string | null; staffName: string; totalCents: number }[];
  discounts: { number: number; amountCents: number; approvedBy: string | null }[];
  /** Unpaid delivery orders that carry over to the next day. */
  carried: { number: number; customerName: string; balanceCents: number }[];
  /** Other unpaid orders a manager chose to leave unpaid. */
  leftUnpaid: { number: number; customerName: string; balanceCents: number; staffName: string }[];
  /** Unpaid orders that are not delivery and nobody has dealt with yet; a Z waits for these. */
  unresolved: { id: string; number: number; customerName: string; balanceCents: number }[];
  /** Quantity sold in halves, so half-and-half counts ½ for each side without fractions. */
  items: { nameAr: string; sizeAr: string | null; halves: number }[];
  /** Fees drivers kept from the cash for orders delivered today. */
  driverFeesCents: number;
  drivers: DriverRow[];
  floatCents: number;
  expectedCashCents: number;
}

const isOpen = (t: OrderTotals) => t.status === "unpaid" || t.status === "part_paid";

export function dayReport(orders: ReportOrder[], events: ReportEvent[], floatCents: number): DayReport {
  const sold = orders.filter((o) => o.sentToday && o.totals.status !== "voided");
  const sum = (list: ReportOrder[], pick: (t: OrderTotals) => number) => list.reduce((s, o) => s + pick(o.totals), 0);

  const items = new Map<string, { nameAr: string; sizeAr: string | null; halves: number }>();
  const count = (nameAr: string, sizeAr: string | null, halves: number) => {
    const key = `${nameAr}\u0000${sizeAr ?? ""}`;
    const row = items.get(key) ?? { nameAr, sizeAr, halves: 0 };
    row.halves += halves;
    items.set(key, row);
  };
  for (const o of sold) {
    for (const l of o.lines) {
      if (l.otherHalfAr) {
        count(l.nameAr, l.sizeAr, l.qty);
        count(l.otherHalfAr, l.sizeAr, l.qty);
      } else count(l.nameAr, l.sizeAr, 2 * l.qty);
    }
  }

  const payments = events.filter((e) => e.kind === "payment");
  const refunds = events.filter((e) => e.kind === "refund");
  const byNumber = new Map(orders.map((o) => [o.id, o]));
  const cashCents = payments.reduce((s, e) => s + e.amountCents, 0);
  const refundCents = refunds.reduce((s, e) => s + e.amountCents, 0);
  const open = orders.filter((o) => isOpen(o.totals));

  const drivers = new Map<string, DriverRow>();
  const driver = (name: string) => {
    const row = drivers.get(name) ?? { name, orders: 0, collectedCents: 0, feesCents: 0, handInCents: 0 };
    drivers.set(name, row);
    return row;
  };
  for (const e of events) {
    if (!e.driverName) continue;
    if (e.kind === "delivered") {
      driver(e.driverName).orders += 1;
      driver(e.driverName).feesCents += e.amountCents;
    } else if (e.kind === "payment") driver(e.driverName).collectedCents += e.amountCents;
  }
  for (const d of drivers.values()) d.handInCents = d.collectedCents - d.feesCents;
  const driverFeesCents = events.filter((e) => e.kind === "delivered").reduce((s, e) => s + e.amountCents, 0);

  return {
    ordersCount: sold.length,
    grossCents: sum(sold, (t) => t.subtotalCents),
    discountCents: sum(sold, (t) => t.discountCents),
    deliveryFeeCents: sum(sold, (t) => t.deliveryFeeCents),
    netCents: sum(sold, (t) => t.foodCents),
    taxIncludedCents: sum(sold, (t) => t.taxIncludedCents),
    byType: ORDER_TYPES.map((type) => {
      const ofType = sold.filter((o) => o.type === type);
      return { type, count: ofType.length, netCents: sum(ofType, (t) => t.foodCents) };
    }),
    cashCents,
    cashCount: payments.length,
    refundCents,
    refundCount: refunds.length,
    voids: events
      .filter((e) => e.kind === "void")
      .map((e) => ({ number: e.number, reason: e.reason, staffName: e.staffName, totalCents: byNumber.get(e.orderId)?.totals.totalCents ?? 0 })),
    discounts: sold
      .filter((o) => o.totals.discountCents > 0)
      .map((o) => ({ number: o.number, amountCents: o.totals.discountCents, approvedBy: o.discountApprovedBy })),
    carried: open
      .filter((o) => o.type === "delivery")
      .map((o) => ({ number: o.number, customerName: o.customerName, balanceCents: o.totals.balanceCents })),
    leftUnpaid: open
      .filter((o) => o.type !== "delivery" && o.leftUnpaidBy !== null)
      .map((o) => ({ number: o.number, customerName: o.customerName, balanceCents: o.totals.balanceCents, staffName: o.leftUnpaidBy! })),
    unresolved: open
      .filter((o) => o.type !== "delivery" && o.leftUnpaidBy === null)
      .map((o) => ({ id: o.id, number: o.number, customerName: o.customerName, balanceCents: o.totals.balanceCents })),
    items: [...items.values()].sort((a, b) => b.halves - a.halves || a.nameAr.localeCompare(b.nameAr, "ar")),
    driverFeesCents,
    drivers: [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name, "ar")),
    floatCents,
    expectedCashCents: floatCents + cashCents - refundCents - driverFeesCents,
  };
}

/** Adds up a note-by-note cash count (whole pounds) into cents. */
export function countedCents(notes: { pounds: number; count: number }[], otherPounds: number) {
  return (notes.reduce((s, n) => s + n.pounds * n.count, 0) + otherPounds) * 100;
}

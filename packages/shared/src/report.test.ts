import { describe, expect, it } from "vitest";
import { countedCents, dayReport, type ReportEvent, type ReportOrder } from "./report.js";
import { orderTotals } from "./totals.js";

const corn = { qty: 1, nameAr: "بيتزا ذرة", sizeAr: "وسط", otherHalfAr: null };
const soda = { qty: 2, nameAr: "كولا", sizeAr: null, otherHalfAr: null };
const half = { qty: 1, nameAr: "بيتزا ذرة", sizeAr: "وسط", otherHalfAr: "بيتزا السلطان" };

function order(n: number, type: ReportOrder["type"], subtotal: number, events: Parameters<typeof orderTotals>[1], extra: Partial<ReportOrder> = {}): ReportOrder {
  return {
    id: `o${n}`,
    number: n,
    type,
    customerName: `زبون ${n}`,
    totals: orderTotals(subtotal, events, 500),
    sentToday: true,
    discountApprovedBy: null,
    leftUnpaidBy: null,
    lines: [corn],
    ...extra,
  };
}

const ev = (o: ReportOrder, kind: ReportEvent["kind"], amountCents: number, reason: string | null = null): ReportEvent => ({
  orderId: o.id,
  number: o.number,
  kind,
  amountCents,
  staffName: "سامر",
  reason,
});

describe("dayReport", () => {
  // 1: pickup 750, paid cash.
  // 2: delivery 850 + fee 300 − 10% (85) = 1,065, unpaid: carried over.
  // 3: dine-in 2,100 voided.
  // 4: dine-in 3,250 paid, then refunded.
  // 5: dine-in 1,000 unpaid, nobody has dealt with it.
  // 6: pickup 950 unpaid, left unpaid by the manager.
  // 7: a delivery from yesterday (1,200), paid today.
  const o1 = order(1, "pickup", 75_000, [{ kind: "payment", amountCents: 75_000 }], { lines: [corn] });
  const o2 = order(2, "delivery", 85_000, [{ kind: "delivery_fee", amountCents: 30_000 }, { kind: "discount", amountCents: 8_500 }], {
    discountApprovedBy: "مشرف",
    lines: [corn, { ...soda, qty: 1 }],
  });
  const o3 = order(3, "dine_in", 210_000, [{ kind: "void" }], { lines: [soda] });
  const o4 = order(4, "dine_in", 325_000, [{ kind: "payment", amountCents: 325_000 }, { kind: "refund", amountCents: 325_000 }], { lines: [half] });
  const o5 = order(5, "dine_in", 100_000, [], { lines: [soda] });
  const o6 = order(6, "pickup", 95_000, [], { leftUnpaidBy: "مشرف", lines: [] });
  const o7 = order(7, "delivery", 120_000, [{ kind: "payment", amountCents: 120_000 }], { sentToday: false, lines: [soda] });
  const events = [ev(o1, "payment", 75_000), ev(o3, "void", 0, "wrong_order"), ev(o4, "payment", 325_000), ev(o4, "refund", 325_000), ev(o7, "payment", 120_000)];
  const report = dayReport([o1, o2, o3, o4, o5, o6, o7], events, 50_000);

  it("counts the day's sales, without voided orders or yesterday's carried order", () => {
    expect(report).toMatchObject({
      ordersCount: 5,
      grossCents: 75_000 + 85_000 + 325_000 + 100_000 + 95_000,
      discountCents: 8_500,
      deliveryFeeCents: 30_000,
      netCents: 75_000 + 106_500 + 325_000 + 100_000 + 95_000,
    });
    // 750 → 36, 1,065 → 51, 3,250 → 155, 1,000 → 48, 950 → 45
    expect(report.taxIncludedCents).toBe((36 + 51 + 155 + 48 + 45) * 100);
    expect(report.byType).toEqual([
      { type: "dine_in", count: 2, netCents: 425_000 },
      { type: "pickup", count: 2, netCents: 170_000 },
      { type: "delivery", count: 1, netCents: 106_500 },
    ]);
  });

  it("counts cash taken today, including yesterday's delivery, and the refund given back", () => {
    expect(report).toMatchObject({ cashCents: 520_000, cashCount: 3, refundCents: 325_000, refundCount: 1 });
    // float 500 + cash 5,200 − refund 3,250 = 2,450
    expect(report.expectedCashCents).toBe(245_000);
  });

  it("lists voids, discounts and unpaid orders", () => {
    expect(report.voids).toEqual([{ number: 3, reason: "wrong_order", staffName: "سامر", totalCents: 210_000 }]);
    expect(report.discounts).toEqual([{ number: 2, amountCents: 8_500, approvedBy: "مشرف" }]);
    expect(report.carried).toEqual([{ number: 2, customerName: "زبون 2", balanceCents: 106_500 }]);
    expect(report.leftUnpaid).toEqual([{ number: 6, customerName: "زبون 6", balanceCents: 95_000, staffName: "مشرف" }]);
    expect(report.unresolved).toEqual([{ id: "o5", number: 5, customerName: "زبون 5", balanceCents: 100_000 }]);
  });

  it("counts items in halves, so a half-and-half gives each side ½", () => {
    // Corn: 1 (o1) + 1 (o2) + ½ (o4) = 2½ → 5 halves. Sultan ½. Cola: o2 1 + o5 2 = 3 → 6 halves.
    expect(report.items).toEqual([
      { nameAr: "كولا", sizeAr: null, halves: 6 },
      { nameAr: "بيتزا ذرة", sizeAr: "وسط", halves: 5 },
      { nameAr: "بيتزا السلطان", sizeAr: "وسط", halves: 1 },
    ]);
  });

  it("is all zeros on a quiet day", () => {
    expect(dayReport([], [], 0)).toMatchObject({ ordersCount: 0, netCents: 0, expectedCashCents: 0, items: [] });
  });
});

describe("countedCents", () => {
  it("adds up each note and the coins", () => {
    expect(countedCents([{ pounds: 500, count: 4 }, { pounds: 100, count: 3 }, { pounds: 10, count: 0 }], 25)).toBe(232_500);
  });
});

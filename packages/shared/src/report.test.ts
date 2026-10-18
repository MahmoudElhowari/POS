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
  // 2: delivery 850 − 10% (85) = 765 food + fee 300 = 1,065, unpaid: carried over.
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

  it("counts the day's food sales, without voided orders, yesterday's carried order or the drivers' fees", () => {
    expect(report).toMatchObject({
      ordersCount: 5,
      grossCents: 75_000 + 85_000 + 325_000 + 100_000 + 95_000,
      discountCents: 8_500,
      deliveryFeeCents: 30_000,
      netCents: 75_000 + 76_500 + 325_000 + 100_000 + 95_000,
    });
    // Tax on the food only: 750 → 36, 765 → 36, 3,250 → 155, 1,000 → 48, 950 → 45
    expect(report.taxIncludedCents).toBe((36 + 36 + 155 + 48 + 45) * 100);
    expect(report.byType).toEqual([
      { type: "dine_in", count: 2, netCents: 425_000 },
      { type: "pickup", count: 2, netCents: 170_000 },
      { type: "delivery", count: 1, netCents: 76_500 },
    ]);
  });

  it("counts cash taken today, including yesterday's delivery, and the refund given back", () => {
    expect(report).toMatchObject({ cashCents: 520_000, cashCount: 3, refundCents: 325_000, refundCount: 1 });
    // float 500 + cash 5,200 − refund 3,250 = 2,450
    expect(report.expectedCashCents).toBe(245_000);
  });

  it("lists voids, discounts and unpaid orders", () => {
    expect(report.voids).toEqual([{ number: 3, reason: "wrong_order", staffName: "سامر", totalCents: 210_000 }]);
    expect(report.discounts).toEqual([{ number: 2, amountCents: 8_500, approvedBy: "مشرف", coupon: null }]);
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

  it("adds up each driver's orders, cash and fees, and takes the fees out of the drawer", () => {
    // Abu Ali delivers 8 (1,000 + fee 300, collected 1,300) and 9 (600 + fee 200, paid at the counter).
    const o8 = order(8, "delivery", 100_000, [{ kind: "delivery_fee", amountCents: 30_000 }, { kind: "payment", amountCents: 130_000 }]);
    const o9 = order(9, "delivery", 60_000, [{ kind: "delivery_fee", amountCents: 20_000 }, { kind: "payment", amountCents: 80_000 }]);
    const r = dayReport(
      [o8, o9],
      [
        { ...ev(o9, "payment", 80_000) },
        { ...ev(o8, "payment", 130_000), driverName: "أبو علي" },
        { ...ev(o8, "delivered", 30_000), driverName: "أبو علي" },
        { ...ev(o9, "delivered", 20_000), driverName: "أبو علي" },
      ],
      0,
    );
    expect(r.drivers).toEqual([{ name: "أبو علي", orders: 2, collectedCents: 130_000, feesCents: 50_000, handInCents: 80_000 }]);
    expect(r).toMatchObject({ netCents: 160_000, deliveryFeeCents: 50_000, driverFeesCents: 50_000, cashCents: 210_000 });
    // Cash 2,100 − fees 500 = 1,600: the food.
    expect(r.expectedCashCents).toBe(160_000);
  });

  it("splits cash from wallets, and keeps wallet money and wallet refunds out of the drawer", () => {
    // 10: 1,500 paid 1,000 by Syriatel Cash and 500 cash. 11: 800 by MTN Cash, then refunded the same way.
    const o10 = order(10, "pickup", 150_000, [
      { kind: "payment", amountCents: 100_000 },
      { kind: "payment", amountCents: 50_000 },
    ]);
    const o11 = order(11, "pickup", 80_000, [
      { kind: "payment", amountCents: 80_000 },
      { kind: "refund", amountCents: 80_000 },
    ]);
    const syriatel = { method: "wallet" as const, walletName: "سيريتل كاش" };
    const mtn = { method: "wallet" as const, walletName: "MTN كاش" };
    const r = dayReport(
      [o10, o11],
      [
        { ...ev(o10, "payment", 100_000), ...syriatel },
        { ...ev(o10, "payment", 50_000), method: "cash" },
        { ...ev(o11, "payment", 80_000), ...mtn },
        { ...ev(o11, "refund", 80_000), ...mtn },
      ],
      10_000,
    );
    expect(r).toMatchObject({ cashCents: 50_000, cashCount: 1, refundCents: 80_000, refundCount: 1, cashRefundCents: 0 });
    expect(r.wallets).toEqual([
      { name: "سيريتل كاش", count: 1, amountCents: 100_000 },
      { name: "MTN كاش", count: 1, amountCents: 80_000 },
    ]);
    // Float 100 + cash 500 = 600.
    expect(r.expectedCashCents).toBe(60_000);
  });

  it("counts a driver's wallet payments as nothing to hand in", () => {
    const o12 = order(12, "delivery", 100_000, [
      { kind: "delivery_fee", amountCents: 30_000 },
      { kind: "payment", amountCents: 130_000 },
    ]);
    const r = dayReport(
      [o12],
      [
        { ...ev(o12, "payment", 130_000), driverName: "حسام", method: "wallet", walletName: "شام كاش" },
        { ...ev(o12, "delivered", 30_000), driverName: "حسام" },
      ],
      0,
    );
    expect(r.drivers).toEqual([{ name: "حسام", orders: 1, collectedCents: 0, feesCents: 30_000, handInCents: -30_000 }]);
    // The drawer pays the driver's fee.
    expect(r.expectedCashCents).toBe(-30_000);
  });

  it("adds up each coupon's orders and what it took off", () => {
    const o13 = order(13, "pickup", 100_000, [{ kind: "discount", amountCents: 10_000 }], { couponCode: "PIZZA10" });
    const o14 = order(14, "pickup", 50_000, [{ kind: "discount", amountCents: 5_000 }], { couponCode: "PIZZA10" });
    const o15 = order(15, "pickup", 50_000, [{ kind: "discount", amountCents: 5_000 }, { kind: "void" }], { couponCode: "PIZZA10" });
    const r = dayReport([o13, o14, o15], [], 0);
    expect(r.coupons).toEqual([{ code: "PIZZA10", orders: 2, amountCents: 15_000 }]);
    expect(r.discounts.map((d) => d.coupon)).toEqual(["PIZZA10", "PIZZA10"]);
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

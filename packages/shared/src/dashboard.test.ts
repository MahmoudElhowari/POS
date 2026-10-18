import { describe, expect, it } from "vitest";
import {
  addDays,
  type DashboardEvent,
  type DashboardOrder,
  dashboard,
  halvesCell,
  periodRange,
  poundsCell,
  previousRange,
  shareCell,
  toCsv,
  weekdayOf,
} from "./dashboard.js";
import { orderTotals } from "./totals.js";

const line = (nameAr: string, totalCents: number, extra: Partial<DashboardOrder["lines"][number]> = {}) => ({
  qty: 1,
  nameAr,
  sizeAr: "وسط",
  otherHalfAr: null,
  categoryAr: "البيتزا",
  totalCents,
  ...extra,
});

function order(
  businessDate: string,
  hour: number,
  type: DashboardOrder["type"],
  lines: DashboardOrder["lines"],
  events: Parameters<typeof orderTotals>[1] = [],
) {
  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  return { type, businessDate, hour, totals: orderTotals(subtotal, events, 500), lines };
}

describe("periods", () => {
  // 2026-10-18 is a Sunday.
  const today = "2026-10-21";

  it("starts weeks on Sunday and months on the 1st", () => {
    expect(weekdayOf("2026-10-18")).toBe(0);
    expect(periodRange("today", today)).toEqual({ from: today, to: today });
    expect(periodRange("yesterday", today)).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(periodRange("this_week", today)).toEqual({ from: "2026-10-18", to: today });
    expect(periodRange("last_week", today)).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    expect(periodRange("this_month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(periodRange("last_month", "2026-03-05")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("this_week", "2026-10-18")).toEqual({ from: "2026-10-18", to: "2026-10-18" });
  });

  it("compares with the period of the same length just before", () => {
    expect(previousRange("2026-10-18", "2026-10-24")).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    expect(previousRange("2026-10-01", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("dashboard", () => {
  const from = "2026-10-18";
  const to = "2026-10-24";
  const orders = [
    // Sunday 8 PM: Corn 750 and two colas 200, 10% off (95) = 855.
    order(
      from,
      20,
      "pickup",
      [line("بيتزا ذرة", 750), line("كولا", 200, { sizeAr: null, categoryAr: "المشروبات", qty: 2 })],
      [{ kind: "discount", amountCents: 95 }],
    ),
    // Sunday 1 AM (still Sunday's business day): ½ Corn ½ Sultan Large 2,300, with a 300 delivery fee.
    order(from, 1, "delivery", [line("بيتزا ذرة", 2_300, { sizeAr: "كبير", otherHalfAr: "بيتزا السلطان" })], [{ kind: "delivery_fee", amountCents: 300 }]),
    // Monday 8 PM, dine-in Sultan Large 2,200.
    order("2026-10-19", 20, "dine_in", [line("بيتزا السلطان", 2_200, { sizeAr: "كبير" })]),
    // Monday, voided: never counted.
    order("2026-10-19", 21, "dine_in", [line("بيتزا ذرة", 750)], [{ kind: "void" }]),
  ];
  const events: DashboardEvent[] = [
    { kind: "payment", amountCents: 855 },
    { kind: "payment", amountCents: 1_000, method: "wallet", walletName: "سيريتل كاش" },
    { kind: "payment", amountCents: 1_501, method: "wallet", walletName: "شام كاش" },
    { kind: "payment", amountCents: 2_200, method: "cash" },
    { kind: "refund", amountCents: 200 },
    { kind: "void", amountCents: 0 },
  ];
  const d = dashboard({
    from,
    to,
    orders,
    events,
    openDates: [from, "2026-10-19", "2026-10-20"],
    stock: [
      { nameAr: "طحين", unit: "g", qty: 25_000, costCents: 400_000 },
      { nameAr: "طحين", unit: "g", qty: 25_000, costCents: null },
      { nameAr: "كولا · علبة", unit: "piece", qty: 48, costCents: 480_000 },
    ],
  });

  it("adds up sales like the Z: food after discounts, no fees, no voided orders", () => {
    expect(d.headline).toEqual({
      salesCents: 855 + 2_300 + 2_200,
      orders: 3,
      averageCents: Math.floor(5_355 / 3),
      discountCents: 95,
      refundCents: 200,
      voids: 1,
    });
    expect(d.byType).toEqual([
      { type: "dine_in", count: 1, salesCents: 2_200 },
      { type: "pickup", count: 1, salesCents: 855 },
      { type: "delivery", count: 1, salesCents: 2_300 },
    ]);
  });

  it("puts cash first, then each wallet by amount", () => {
    expect(d.byMethod).toEqual([
      { walletName: null, count: 2, amountCents: 3_055 },
      { walletName: "شام كاش", count: 1, amountCents: 1_501 },
      { walletName: "سيريتل كاش", count: 1, amountCents: 1_000 },
    ]);
  });

  it("splits sales by hour, by day and by weekday", () => {
    expect(d.hours[20]).toEqual({ hour: 20, orders: 2, salesCents: 855 + 2_200 });
    expect(d.hours[1]).toEqual({ hour: 1, orders: 1, salesCents: 2_300 });
    expect(d.hours[21]!.orders).toBe(0);
    expect(d.days).toHaveLength(7);
    expect(d.days.slice(0, 3).map((x) => x.salesCents)).toEqual([855 + 2_300, 2_200, 0]);
    expect(d.weekdays[0]).toEqual({ weekday: 0, openDays: 1, salesCents: 3_155, averageCents: 3_155 });
    expect(d.weekdays[2]).toEqual({ weekday: 2, openDays: 1, salesCents: 0, averageCents: 0 });
    expect(d.weekdays[6]).toEqual({ weekday: 6, openDays: 0, salesCents: 0, averageCents: 0 });
  });

  it("gives each half of a half-and-half half the price, and works out shares", () => {
    const item = (name: string, size: string | null) => d.items.find((i) => i.nameAr === name && i.sizeAr === size)!;
    expect(item("بيتزا ذرة", "كبير")).toMatchObject({ halves: 1, salesCents: 1_200 });
    expect(item("بيتزا السلطان", "كبير")).toMatchObject({ halves: 3, salesCents: 1_100 + 2_200 });
    expect(item("كولا", null)).toMatchObject({ halves: 4, salesCents: 200, categoryAr: "المشروبات" });
    expect(d.itemsTotalCents).toBe(750 + 200 + 2_300 + 2_200);
    expect(d.items[0]!.nameAr).toBe("بيتزا السلطان");
    expect(d.categories).toEqual([
      { nameAr: "البيتزا", halves: 6, salesCents: 5_250, shareBp: 9_633 },
      { nameAr: "المشروبات", halves: 4, salesCents: 200, shareBp: 367 },
    ]);
  });

  it("adds up what deliveries cost, by stock item", () => {
    expect(d.stock).toEqual({
      totalCents: 880_000,
      items: [
        { nameAr: "كولا · علبة", unit: "piece", qty: 48, deliveries: 1, costCents: 480_000 },
        { nameAr: "طحين", unit: "g", qty: 50_000, deliveries: 2, costCents: 400_000 },
      ],
    });
  });

  it("has no weekdays for a period shorter than a week", () => {
    expect(dashboard({ from, to: from, orders, events, openDates: [from], stock: [] }).weekdays).toEqual([]);
  });
});

describe("spreadsheet cells", () => {
  it("writes pounds, halves and shares as plain numbers", () => {
    expect([125_050, 200, 0, -1_500, 105].map(poundsCell)).toEqual(["1250.5", "2", "0", "-15", "1.05"]);
    expect([0, 1, 4, 5].map(halvesCell)).toEqual(["0", "0.5", "2", "2.5"]);
    expect(shareCell(9_626)).toBe("96.26");
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting, keeps formulas as text and starts with a BOM for Excel", () => {
    expect(
      toCsv([
        ["الصنف", "المبيعات"],
        ['كولا, "علبة"', 200],
        ["=1+1", -5],
      ]),
    ).toBe('﻿الصنف,المبيعات\r\n"كولا, ""علبة""",200\r\n\'=1+1,-5\r\n');
  });
});

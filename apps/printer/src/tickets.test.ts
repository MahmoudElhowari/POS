import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CustomerReceipt, DayReportPaper, KitchenTicket } from "@pos/shared";
import { halvesText, kitchenLines, percentText, receiptLines, renderKitchenTicket, renderReceipt, renderReport, reportLines } from "./tickets.js";

const store = { restaurantAr: "رومانتيكا بيتزا", restaurantEn: "Romantica Pizza", timeZone: "Asia/Damascus" };

const kitchen: KitchenTicket = {
  number: 12,
  type: "delivery",
  tableNo: null,
  customerName: "أبو أحمد",
  area: "المزة",
  directions: "قرب الجامع، الطابق الثالث",
  note: "اتصلوا قبل الوصول",
  sentAt: "2026-10-17T16:05:00Z",
  reprint: false,
  lines: [
    { qty: 1, nameAr: "بيتزا السلطان", sizeAr: "كبير", otherHalfAr: "بيتزا ذرة", addonsAr: [], removalsAr: [], note: "" },
    { qty: 2, nameAr: "بيتزا ذرة", sizeAr: "وسط", otherHalfAr: null, addonsAr: ["محشية الأطراف"], removalsAr: ["صوص", "زيتون"], note: "مقرمشة" },
    { qty: 1, nameAr: "مشروب غازي", sizeAr: null, otherHalfAr: null, addonsAr: [], removalsAr: [], note: "" },
  ],
};

const receipt: CustomerReceipt = {
  number: 12,
  type: "delivery",
  tableNo: null,
  customerName: "أبو أحمد",
  cashierName: "سامر",
  sentAt: "2026-10-17T16:05:00Z",
  reprint: false,
  lines: [
    { qty: 1, nameAr: "بيتزا السلطان", nameEn: "Sultan Pizza", sizeAr: "كبير", sizeEn: "Large", otherHalfAr: null, otherHalfEn: null, addons: [], totalCents: 220_000 },
    {
      qty: 1, nameAr: "بيتزا ذرة", nameEn: "Corn Pizza", sizeAr: "وسط", sizeEn: "Regular", otherHalfAr: null, otherHalfEn: null,
      addons: [{ nameAr: "محشية الأطراف", nameEn: "Stuffed crust" }], totalCents: 95_000,
    },
    { qty: 1, nameAr: "مشروب غازي", nameEn: "Soda", sizeAr: null, sizeEn: null, otherHalfAr: null, otherHalfEn: null, addons: [], totalCents: 10_000 },
  ],
  subtotalCents: 325_000,
  discountCents: 32_500,
  deliveryFeeCents: 30_000,
  totalCents: 322_500,
  taxIncludedCents: 15_400,
  taxRateBp: 500,
  taxNameAr: "ضريبة",
  paidCents: 322_500,
  tenderedCents: 500_000,
  changeCents: 177_500,
  status: "paid",
  phone: "",
  address: "",
  footer: "",
};

const texts = (lines: ReturnType<typeof kitchenLines>) =>
  lines.flatMap((l) => (l.kind === "text" ? [l.text] : l.kind === "row" ? [`${l.start} | ${l.end}`] : []));

// Saved for a human to check the Arabic by eye.
const out = fileURLToPath(new URL("../../../printer-output/", import.meta.url));
async function save(name: string, canvas: { encode: (f: "png") => Promise<Buffer> }) {
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}${name}`, await canvas.encode("png"));
}

describe("kitchen ticket", () => {
  it("shows the number, where it goes and what to make, with no prices", async () => {
    const lines = texts(kitchenLines(kitchen, store));
    expect(lines[0]).toBe("#12");
    expect(lines).toContain("توصيل");
    expect(lines).toContain("المنطقة: المزة");
    expect(lines.some((l) => l.includes("نص بيتزا السلطان / نص بيتزا ذرة"))).toBe(true);
    expect(lines).toContain("+ محشية الأطراف");
    expect(lines).toContain("بدون: صوص، زيتون");
    expect(lines).toContain("ملاحظة: مقرمشة");
    expect(lines.join(" ")).not.toMatch(/ل\.س/);

    const { canvas, bitmap } = renderKitchenTicket(kitchen, store, 576);
    expect(bitmap.width).toBe(576);
    expect(bitmap.height).toBeGreaterThan(600);
    await save("kitchen-sample.png", canvas);
  });

  it("marks a reprint and shows the table for dine-in", () => {
    const lines = texts(kitchenLines({ ...kitchen, type: "dine_in", tableNo: 4, reprint: true }, store));
    expect(lines[0]).toContain("نسخة معادة");
    expect(lines.some((l) => l.startsWith("طاولة") && l.includes("4"))).toBe(true);
  });
});

describe("customer receipt", () => {
  it("shows the total, the tax already included, the cash and the change", async () => {
    const lines = texts(receiptLines(receipt, store));
    expect(lines).toContain("الخصم | -325");
    expect(lines).toContain("أجرة التوصيل | 300");
    expect(lines).toContain("الإجمالي | 3,225 ل.س");
    expect(lines.find((l) => l.startsWith("يشمل ضريبة"))).toContain("154 ل.س");
    expect(lines).toContain("نقداً | 5,000");
    expect(lines).toContain("الباقي | 1,775");
    expect(lines).toContain("Sultan Pizza · Large");

    const { canvas } = renderReceipt(receipt, store, 576);
    await save("receipt-sample.png", canvas);
  });

  it("shows what is still owed on an unpaid receipt, and nothing about tax when there is none", () => {
    const lines = texts(receiptLines({ ...receipt, status: "unpaid", paidCents: 0, taxRateBp: 0 }, store));
    expect(lines).toContain("المتبقي | 3,225 ل.س");
    expect(lines.some((l) => l.startsWith("يشمل"))).toBe(false);
  });

  it("lists a split payment: the wallet with its transfer number, then the cash and change, and the coupon", async () => {
    const split: CustomerReceipt = {
      ...receipt,
      couponCode: "PIZZA10",
      payments: [
        { method: "wallet", nameAr: "سيريتل كاش", amountCents: 200_000, tenderedCents: 200_000, changeCents: 0, reference: "TX-889" },
        { method: "cash", nameAr: "نقداً", amountCents: 122_500, tenderedCents: 150_000, changeCents: 27_500, reference: null },
      ],
    };
    const lines = texts(receiptLines(split, store));
    expect(lines.find((l) => l.startsWith("الخصم (كوبون"))).toContain("PIZZA10");
    expect(lines).toContain("سيريتل كاش | 2,000");
    expect(lines.find((l) => l.startsWith("رقم العملية"))).toContain("TX-889");
    expect(lines).toContain("نقداً | 1,500");
    expect(lines).toContain("الباقي | 275");
    await save("receipt-split-sample.png", renderReceipt(split, store, 576).canvas);
  });

  it("fits a 58 mm printer", () => {
    expect(renderReceipt(receipt, store, 384).bitmap.width).toBe(384);
  });
});

describe("percentText", () => {
  it("writes basis points as a percent without floats", () => {
    expect([500, 550, 1000, 1250, 5].map(percentText)).toEqual(["5", "5.5", "10", "12.5", "0.05"]);
  });
});

const zPaper: DayReportPaper = {
  kind: "z",
  number: 3,
  date: "2026-10-17",
  openedAt: "2026-10-17T01:00:00Z",
  printedAt: "2026-10-17T21:30:00Z",
  printedBy: "مشرف",
  closeKind: "manual",
  reprint: false,
  report: {
    ordersCount: 5,
    grossCents: 680_000,
    discountCents: 8_500,
    deliveryFeeCents: 30_000,
    netCents: 671_500,
    taxIncludedCents: 32_000,
    byType: [
      { type: "dine_in", count: 2, netCents: 425_000 },
      { type: "pickup", count: 2, netCents: 170_000 },
      { type: "delivery", count: 1, netCents: 76_500 },
    ],
    cashCents: 520_000,
    cashCount: 3,
    refundCents: 325_000,
    refundCount: 1,
    voids: [{ number: 3, reason: "wrong_order", staffName: "سامر", totalCents: 210_000 }],
    discounts: [{ number: 2, amountCents: 8_500, approvedBy: "مشرف" }],
    carried: [{ number: 2, customerName: "أبو أحمد", balanceCents: 106_500 }],
    leftUnpaid: [{ number: 6, customerName: "أم علي", balanceCents: 95_000, staffName: "مشرف" }],
    unresolved: [],
    items: [
      { nameAr: "بيتزا ذرة", sizeAr: "وسط", halves: 5 },
      { nameAr: "بيتزا السلطان", sizeAr: "وسط", halves: 1 },
    ],
    driverFeesCents: 20_000,
    drivers: [{ name: "أبو علي", orders: 1, collectedCents: 120_000, feesCents: 20_000, handInCents: 100_000 }],
    floatCents: 50_000,
    expectedCashCents: 225_000,
  },
  count: { notes: [{ pounds: 500, count: 4 }, { pounds: 100, count: 4 }], otherCents: 3_000, countedCents: 243_000, differenceCents: -2_000 },
};

describe("X and Z reports", () => {
  it("shows the sales, the cash expected, the count and the difference", async () => {
    const lines = texts(reportLines(zPaper, store));
    expect(lines.some((l) => l.includes("تقرير Z رقم") && l.includes("3"))).toBe(true);
    expect(lines).toContain("الصافي | 6,715 ل.س");
    expect(lines).toContain("أجرة التوصيل (للسائقين) | 300");
    expect(lines.some((l) => l.startsWith("أبو علي (") && l.endsWith(" | 1,000"))).toBe(true);
    expect(lines).toContain("− أجرة السائقين | 200");
    expect(lines).toContain("الفرق (نقص) | -20");
    expect(lines).toContain("المتوقع في الصندوق | 2,250 ل.س");
    expect(lines).toContain("بيتزا ذرة · وسط | 2½");
    expect(lines).toContain("#6 · أم علي | 950");
    await save("z-report-sample.png", renderReport(zPaper, store, 576).canvas);
  });

  it("shows wallets, coupons and cash refunds, and keeps wallet refunds out of the drawer", () => {
    const report = {
      ...zPaper.report,
      wallets: [{ name: "شام كاش", count: 2, amountCents: 150_000 }],
      refundCents: 100_000,
      refundCount: 2,
      cashRefundCents: 40_000,
      discounts: [{ number: 2, amountCents: 8_500, approvedBy: null, coupon: "PIZZA10" }],
      coupons: [{ code: "PIZZA10", orders: 1, amountCents: 8_500 }],
    };
    const lines = texts(reportLines({ ...zPaper, report }, store));
    expect(lines.some((l) => l.startsWith("شام كاش (") && l.endsWith(" | 1,500"))).toBe(true);
    expect(lines.some((l) => l.startsWith("منها نقداً 400"))).toBe(true);
    expect(lines).toContain("− المبالغ المستردة نقداً | 400");
    expect(lines).toContain("الكوبونات");
    expect(lines.some((l) => l.startsWith("#2 · كوبون") && l.endsWith(" | 85"))).toBe(true);
  });

  it("leaves the count off an X report", () => {
    const lines = texts(reportLines({ ...zPaper, kind: "x", number: null, closeKind: null, count: null }, store));
    expect(lines[1]).toContain("تقرير X");
    expect(lines.some((l) => l.startsWith("الفرق"))).toBe(false);
  });

  it("writes halves as a count", () => {
    expect([0, 1, 2, 5].map(halvesText)).toEqual(["0", "½", "1", "2½"]);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CustomerReceipt, KitchenTicket } from "@pos/shared";
import { kitchenLines, percentText, receiptLines, renderKitchenTicket, renderReceipt } from "./tickets.js";

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

  it("fits a 58 mm printer", () => {
    expect(renderReceipt(receipt, store, 384).bitmap.width).toBe(384);
  });
});

describe("percentText", () => {
  it("writes basis points as a percent without floats", () => {
    expect([500, 550, 1000, 1250, 5].map(percentText)).toEqual(["5", "5.5", "10", "12.5", "0.05"]);
  });
});

import { cents, type CustomerReceipt, formatSyp, type KitchenTicket, type OrderType } from "@pos/shared";
import { type Line, ltr, renderLines } from "./render.js";

// The two order papers. Text on paper is Arabic first; the customer receipt
// adds small English under each item (M2 decision).

export interface PaperStore {
  restaurantAr: string;
  restaurantEn: string;
  timeZone: string;
}

const TYPE_AR: Record<OrderType, string> = { dine_in: "داخل المطعم", pickup: "استلام", delivery: "توصيل" };
const TYPE_EN: Record<OrderType, string> = { dine_in: "Dine in", pickup: "Pickup", delivery: "Delivery" };

const text = (t: string, size: number, opts: { bold?: boolean; align?: "center" | "start" | "right"; dir?: "rtl" | "ltr" } = {}): Line => ({
  kind: "text",
  text: t,
  size,
  bold: opts.bold ?? false,
  align: opts.align ?? "start",
  dir: opts.dir ?? "rtl",
});

function when(iso: string, timeZone: string) {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, timeStyle: "short" }).format(at);
  return { date, time };
}

/** 500 → "5", 550 → "5.5" without floating point. */
export function percentText(bp: number) {
  const whole = Math.trunc(bp / 100);
  const frac = bp % 100;
  return frac ? `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}` : String(whole);
}

const amount = (c: number) => Math.trunc(c / 100).toLocaleString("en-US");
const syp = (c: number) => formatSyp(cents(c));

export function kitchenLines(t: KitchenTicket, store: PaperStore): Line[] {
  const { time } = when(t.sentAt, store.timeZone);
  const where = t.type === "dine_in" && t.tableNo ? `طاولة ${ltr(String(t.tableNo))}` : TYPE_AR[t.type];
  const out: Line[] = [];
  if (t.reprint) out.push(text("** نسخة معادة **", 30, { bold: true, align: "center" }));
  out.push(
    text(`#${t.number}`, 96, { bold: true, align: "center", dir: "ltr" }),
    text(where, 48, { bold: true, align: "center" }),
    text(`${t.customerName} · ${ltr(time)}`, 28, { align: "center" }),
  );
  if (t.type === "delivery") {
    if (t.area) out.push(text(`المنطقة: ${t.area}`, 28));
    if (t.directions) out.push(text(`العنوان: ${t.directions}`, 26));
  }
  out.push({ kind: "rule" });
  for (const l of t.lines) {
    const name = l.otherHalfAr ? `نص ${l.nameAr} / نص ${l.otherHalfAr}` : l.nameAr;
    out.push(text(`${ltr(`${l.qty}×`)} ${name}${l.sizeAr ? ` · ${l.sizeAr}` : ""}`, 38, { bold: true }));
    for (const a of l.addonsAr) out.push(text(`+ ${a}`, 30));
    if (l.removalsAr.length) out.push(text(`بدون: ${l.removalsAr.join("، ")}`, 32, { bold: true }));
    if (l.note) out.push(text(`ملاحظة: ${l.note}`, 30));
    out.push({ kind: "gap", height: 10 });
  }
  if (t.note) out.push({ kind: "rule" }, text(`ملاحظة الطلب: ${t.note}`, 32, { bold: true }));
  out.push({ kind: "rule" }, { kind: "gap", height: 8 });
  return out;
}

export function receiptLines(r: CustomerReceipt, store: PaperStore): Line[] {
  const { date, time } = when(r.sentAt, store.timeZone);
  const out: Line[] = [
    text(store.restaurantAr, 52, { bold: true, align: "center" }),
    text(store.restaurantEn, 26, { align: "center", dir: "ltr" }),
  ];
  if (r.address) out.push(text(r.address, 24, { align: "center" }));
  if (r.phone) out.push(text(r.phone, 24, { align: "center", dir: "ltr" }));
  if (r.reprint) out.push(text("** نسخة **", 28, { bold: true, align: "center" }));
  const where = r.type === "dine_in" && r.tableNo ? `${TYPE_AR[r.type]} · طاولة ${ltr(String(r.tableNo))}` : TYPE_AR[r.type];
  out.push(
    { kind: "rule" },
    text(`طلب رقم ${ltr(String(r.number))} · ${where}`, 34, { bold: true, align: "center" }),
    text(`Order #${r.number} · ${TYPE_EN[r.type]}`, 22, { align: "center", dir: "ltr" }),
    text(`التاريخ: ${ltr(date)}   الوقت: ${ltr(time)}`, 24),
    text(`الزبون: ${r.customerName}`, 24),
    text(`الكاشير: ${r.cashierName}`, 24),
    { kind: "rule" },
  );
  for (const l of r.lines) {
    const name = l.otherHalfAr ? `نص ${l.nameAr} / نص ${l.otherHalfAr}` : l.nameAr;
    out.push({ kind: "row", start: `${ltr(`${l.qty}×`)} ${name}${l.sizeAr ? ` · ${l.sizeAr}` : ""}`, end: amount(l.totalCents), size: 28, bold: true });
    const nameEn = l.otherHalfEn ? `Half ${l.nameEn} / half ${l.otherHalfEn}` : l.nameEn;
    out.push(text(`${nameEn}${l.sizeEn ? ` · ${l.sizeEn}` : ""}`, 20, { align: "right", dir: "ltr" }));
    for (const a of l.addons) out.push(text(`+ ${a.nameAr} (${a.nameEn})`, 22));
  }
  out.push({ kind: "rule" });
  const hasExtras = r.discountCents > 0 || r.deliveryFeeCents > 0;
  if (hasExtras) out.push({ kind: "row", start: "المجموع الفرعي", end: amount(r.subtotalCents), size: 26 });
  if (r.discountCents > 0) out.push({ kind: "row", start: "الخصم", end: `-${amount(r.discountCents)}`, size: 26 });
  if (r.deliveryFeeCents > 0) out.push({ kind: "row", start: "أجرة التوصيل", end: amount(r.deliveryFeeCents), size: 26 });
  out.push({ kind: "row", start: "الإجمالي", end: syp(r.totalCents), size: 38, bold: true });
  if (r.taxRateBp > 0) {
    // Prices already include the tax (Mahmoud, 2026-10-17), so it is shown, never added.
    out.push(text(`يشمل ${r.taxNameAr} ${ltr(`${percentText(r.taxRateBp)}%`)}: ${syp(r.taxIncludedCents)}`, 24));
  }
  out.push({ kind: "rule" });
  if (r.status === "voided") out.push(text("** طلب ملغى **", 40, { bold: true, align: "center" }));
  else if (r.status === "refunded") out.push(text("** تم استرداد المبلغ **", 36, { bold: true, align: "center" }));
  else if (r.status === "paid") {
    if (r.tenderedCents > 0) {
      out.push({ kind: "row", start: "نقداً", end: amount(r.tenderedCents), size: 28 });
      out.push({ kind: "row", start: "الباقي", end: amount(r.changeCents), size: 28, bold: true });
    }
    out.push(text("مدفوع · Paid", 28, { bold: true, align: "center" }));
  } else {
    if (r.paidCents > 0) out.push({ kind: "row", start: "المدفوع", end: amount(r.paidCents), size: 28 });
    out.push({ kind: "row", start: "المتبقي", end: syp(r.totalCents - r.paidCents), size: 32, bold: true });
    out.push(text("غير مدفوع · Not paid", 26, { bold: true, align: "center" }));
  }
  out.push({ kind: "gap", height: 8 }, text(r.footer || "شكراً لزيارتكم", 28, { align: "center" }), { kind: "gap", height: 8 });
  return out;
}

export const renderKitchenTicket = (t: KitchenTicket, store: PaperStore, width: number) => renderLines(kitchenLines(t, store), width);
export const renderReceipt = (r: CustomerReceipt, store: PaperStore, width: number) => renderLines(receiptLines(r, store), width);

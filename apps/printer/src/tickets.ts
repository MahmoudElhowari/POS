import { cents, type CustomerReceipt, type DayReportPaper, formatSyp, type KitchenTicket, type OrderType } from "@pos/shared";
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
  if (r.discountCents > 0) {
    out.push({ kind: "row", start: r.couponCode ? `الخصم (كوبون ${ltr(r.couponCode)})` : "الخصم", end: `-${amount(r.discountCents)}`, size: 26 });
  }
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
    if (r.payments?.length) {
      // Each payment: the cash handed over and its change, or the wallet and its transfer reference.
      for (const p of r.payments) {
        if (p.method === "cash") {
          out.push({ kind: "row", start: "نقداً", end: amount(p.tenderedCents), size: 28 });
          if (p.changeCents > 0 || r.payments.length === 1) out.push({ kind: "row", start: "الباقي", end: amount(p.changeCents), size: 28, bold: true });
        } else {
          out.push({ kind: "row", start: p.nameAr, end: amount(p.amountCents), size: 28 });
          if (p.reference) out.push(text(`رقم العملية: ${ltr(p.reference)}`, 22));
        }
      }
    } else if (r.tenderedCents > 0) {
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

const REASON_AR: Record<string, string> = { customer_cancelled: "الزبون ألغى", wrong_order: "طلب خاطئ", other: "سبب آخر" };

/** Halves as a count: 5 → "2½", 1 → "½". */
export function halvesText(halves: number) {
  const whole = Math.trunc(halves / 2);
  if (halves % 2 === 0) return String(whole);
  return whole ? `${whole}½` : "½";
}

const signed = (c: number) => (c > 0 ? `+${amount(c)}` : c < 0 ? `-${amount(-c)}` : "0");

/** The X report (sales so far) and the Z report (the day closed, with the drawer count). */
export function reportLines(p: DayReportPaper, store: PaperStore): Line[] {
  const r = p.report;
  const opened = when(p.openedAt, store.timeZone);
  const printed = when(p.printedAt, store.timeZone);
  const heading = (t: string): Line[] => [{ kind: "gap", height: 6 }, text(t, 30, { bold: true })];
  const out: Line[] = [
    text(store.restaurantAr, 44, { bold: true, align: "center" }),
    text(p.kind === "x" ? "تقرير X · المبيعات حتى الآن" : `تقرير Z رقم ${ltr(String(p.number))} · إغلاق اليوم`, 34, { bold: true, align: "center" }),
  ];
  if (p.closeKind === "automatic") out.push(text("أُغلق تلقائياً دون عدّ الصندوق", 26, { bold: true, align: "center" }));
  if (p.reprint) out.push(text("** نسخة **", 26, { bold: true, align: "center" }));
  out.push(
    text(`يوم العمل: ${ltr(p.date)}`, 24),
    text(`من ${ltr(`${opened.date} ${opened.time}`)} حتى ${ltr(`${printed.date} ${printed.time}`)}`, 24),
    text(`طبعه: ${p.printedBy}`, 24),
    { kind: "rule" },
    ...heading("المبيعات"),
    { kind: "row", start: "عدد الطلبات", end: String(r.ordersCount), size: 26 },
    { kind: "row", start: "المبيعات قبل الخصم", end: amount(r.grossCents), size: 26 },
    { kind: "row", start: "الخصومات", end: r.discountCents ? `-${amount(r.discountCents)}` : "0", size: 26 },
    { kind: "row", start: "الصافي", end: syp(r.netCents), size: 32, bold: true },
    text(`يشمل الضريبة: ${syp(r.taxIncludedCents)}`, 24),
    // The fees belong to the drivers, so they sit outside the restaurant's sales.
    { kind: "row", start: "أجرة التوصيل (للسائقين)", end: amount(r.deliveryFeeCents), size: 26 },
    ...heading("حسب نوع الطلب"),
    ...r.byType.map((b): Line => ({ kind: "row", start: `${TYPE_AR[b.type]} (${ltr(String(b.count))})`, end: amount(b.netCents), size: 26 })),
    ...heading("المدفوعات"),
    { kind: "row", start: `نقداً (${ltr(String(r.cashCount))})`, end: amount(r.cashCents), size: 26 },
    // Reports frozen before Milestone 8 have no wallets.
    ...(r.wallets ?? []).map((w): Line => ({ kind: "row", start: `${w.name} (${ltr(String(w.count))})`, end: amount(w.amountCents), size: 26 })),
    { kind: "row", start: `المبالغ المستردة (${ltr(String(r.refundCount))})`, end: r.refundCents ? `-${amount(r.refundCents)}` : "0", size: 26 },
  );
  const cashRefundCents = r.cashRefundCents ?? r.refundCents;
  if (cashRefundCents !== r.refundCents) out.push(text(`منها نقداً ${amount(cashRefundCents)} · بالمحفظة ${amount(r.refundCents - cashRefundCents)}`, 22));
  if (r.voids.length) {
    out.push(...heading(`الطلبات الملغاة (${ltr(String(r.voids.length))})`));
    for (const v of r.voids) out.push({ kind: "row", start: `#${v.number} · ${REASON_AR[v.reason ?? ""] ?? ""} · ${v.staffName}`, end: amount(v.totalCents), size: 24 });
  }
  if (r.discounts.length) {
    out.push(...heading(`الخصومات (${ltr(String(r.discounts.length))})`));
    for (const d of r.discounts) {
      const by = d.coupon ? ` · كوبون ${ltr(d.coupon)}` : d.approvedBy ? ` · بموافقة ${d.approvedBy}` : "";
      out.push({ kind: "row", start: `#${d.number}${by}`, end: amount(d.amountCents), size: 24 });
    }
  }
  if (r.coupons?.length) {
    out.push(...heading("الكوبونات"));
    for (const c of r.coupons) out.push({ kind: "row", start: `${ltr(c.code)} (${ltr(String(c.orders))})`, end: amount(c.amountCents), size: 24 });
  }
  const unpaid = (title: string, list: { number: number; customerName: string; balanceCents: number }[]) => {
    if (!list.length) return;
    out.push(...heading(title));
    for (const u of list) out.push({ kind: "row", start: `#${u.number} · ${u.customerName}`, end: amount(u.balanceCents), size: 24 });
  };
  unpaid("توصيل غير مدفوع يُرحّل لليوم التالي", r.carried);
  unpaid("تُرك غير مدفوع", r.leftUnpaid);
  unpaid("غير مدفوع ولم يُسوَّ", r.unresolved);
  // Reports frozen before Milestone 7 have no drivers.
  const drivers = r.drivers ?? [];
  if (drivers.length) {
    out.push(...heading("السائقون"));
    for (const d of drivers) {
      out.push(
        { kind: "row", start: `${d.name} (${ltr(String(d.orders))})`, end: d.handInCents < 0 ? signed(d.handInCents) : amount(d.handInCents), size: 26, bold: true },
        text(`استلم ${amount(d.collectedCents)} · أجرته ${amount(d.feesCents)}`, 22),
      );
    }
  }
  if (r.items.length) {
    out.push(...heading("الأصناف المباعة"));
    for (const i of r.items) out.push({ kind: "row", start: `${i.nameAr}${i.sizeAr ? ` · ${i.sizeAr}` : ""}`, end: halvesText(i.halves), size: 24 });
  }
  out.push(
    { kind: "rule" },
    ...heading("الصندوق"),
    { kind: "row", start: "الرصيد الافتتاحي", end: amount(r.floatCents), size: 26 },
    { kind: "row", start: "+ النقد المستلم", end: amount(r.cashCents), size: 26 },
    { kind: "row", start: "− المبالغ المستردة نقداً", end: amount(cashRefundCents), size: 26 },
    { kind: "row", start: "− أجرة السائقين", end: amount(r.driverFeesCents ?? 0), size: 26 },
    { kind: "row", start: "المتوقع في الصندوق", end: syp(r.expectedCashCents), size: 30, bold: true },
  );
  if (p.count) {
    out.push(...heading("العدّ"));
    for (const n of p.count.notes) out.push({ kind: "row", start: `${ltr(amount(n.pounds * 100))} × ${ltr(String(n.count))}`, end: amount(n.pounds * n.count * 100), size: 24 });
    if (p.count.otherCents) out.push({ kind: "row", start: "فراطة وأخرى", end: amount(p.count.otherCents), size: 24 });
    const diff = p.count.differenceCents;
    out.push(
      { kind: "row", start: "المعدود", end: syp(p.count.countedCents), size: 30, bold: true },
      { kind: "row", start: diff > 0 ? "الفرق (زيادة)" : diff < 0 ? "الفرق (نقص)" : "الفرق (مطابق)", end: signed(diff), size: 34, bold: true },
    );
  }
  out.push({ kind: "rule" }, { kind: "gap", height: 8 });
  return out;
}

export const renderReport = (p: DayReportPaper, store: PaperStore, width: number) => renderLines(reportLines(p, store), width);

export const renderKitchenTicket = (t: KitchenTicket, store: PaperStore, width: number) => renderLines(kitchenLines(t, store), width);
export const renderReceipt = (r: CustomerReceipt, store: PaperStore, width: number) => renderLines(receiptLines(r, store), width);

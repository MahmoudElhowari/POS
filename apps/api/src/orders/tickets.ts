import type { Order, OrderLine } from "@pos/db";
import type { CustomerReceipt, KitchenTicket, OrderTotals } from "@pos/shared";
import type { Settings } from "../settings.js";

const sizeOrNull = (line: OrderLine, name: string) => (line.sizeKey === "one" ? null : name);

/** The kitchen's copy: what to make, no prices. */
export function kitchenTicket(order: Order, lines: OrderLine[], reprint: boolean): KitchenTicket {
  return {
    number: order.number,
    type: order.type,
    tableNo: order.tableNo,
    customerName: order.customerName,
    area: order.deliveryArea,
    directions: order.deliveryDirections,
    note: order.note,
    sentAt: order.sentAt.toISOString(),
    reprint,
    lines: lines.map((l) => ({
      qty: l.qty,
      nameAr: l.nameAr,
      sizeAr: sizeOrNull(l, l.sizeNameAr),
      otherHalfAr: l.otherHalfNameAr,
      addonsAr: l.addons.map((a) => a.nameAr),
      removalsAr: l.removals.map((r) => r.ar),
      note: l.note,
    })),
  };
}

/** The customer's copy, with prices, the tax already included, and the cash and change. */
export function customerReceipt(
  order: Order,
  lines: OrderLine[],
  totals: OrderTotals,
  extra: {
    cashierName: string;
    tenderedCents: number;
    changeCents: number;
    payments: NonNullable<CustomerReceipt["payments"]>;
    couponCode: string | null;
    reprint: boolean;
    settings: Settings;
  },
): CustomerReceipt {
  return {
    number: order.number,
    type: order.type,
    tableNo: order.tableNo,
    customerName: order.customerName,
    cashierName: extra.cashierName,
    sentAt: order.sentAt.toISOString(),
    reprint: extra.reprint,
    lines: lines.map((l) => ({
      qty: l.qty,
      nameAr: l.nameAr,
      nameEn: l.nameEn,
      sizeAr: sizeOrNull(l, l.sizeNameAr),
      sizeEn: sizeOrNull(l, l.sizeNameEn),
      otherHalfAr: l.otherHalfNameAr,
      otherHalfEn: l.otherHalfNameEn,
      addons: l.addons.map((a) => ({ nameAr: a.nameAr, nameEn: a.nameEn })),
      totalCents: l.totalCents,
    })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    totalCents: totals.totalCents,
    taxIncludedCents: totals.taxIncludedCents,
    taxRateBp: order.taxRateBp,
    taxNameAr: extra.settings.tax.nameAr,
    paidCents: totals.paidCents,
    tenderedCents: extra.tenderedCents,
    changeCents: extra.changeCents,
    payments: extra.payments,
    couponCode: extra.couponCode,
    status: totals.status,
    phone: extra.settings.receipt.phone,
    address: extra.settings.receipt.address,
    footer: extra.settings.receipt.footer,
  };
}

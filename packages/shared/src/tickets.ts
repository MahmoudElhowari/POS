import type { OrderType } from "./order.js";
import type { OrderStatus } from "./totals.js";

// What the API puts in a print job and the printer service draws. Everything
// the paper needs is copied in, so a reprint shows the order as it was.

export interface KitchenTicket {
  number: number;
  type: OrderType;
  tableNo: number | null;
  customerName: string;
  area: string;
  directions: string;
  note: string;
  sentAt: string;
  reprint: boolean;
  lines: {
    qty: number;
    nameAr: string;
    /** Null for one-size items. */
    sizeAr: string | null;
    otherHalfAr: string | null;
    addonsAr: string[];
    removalsAr: string[];
    note: string;
  }[];
}

export interface CustomerReceipt {
  number: number;
  type: OrderType;
  tableNo: number | null;
  customerName: string;
  cashierName: string;
  sentAt: string;
  reprint: boolean;
  lines: {
    qty: number;
    nameAr: string;
    nameEn: string;
    sizeAr: string | null;
    sizeEn: string | null;
    otherHalfAr: string | null;
    otherHalfEn: string | null;
    addons: { nameAr: string; nameEn: string }[];
    totalCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  taxIncludedCents: number;
  taxRateBp: number;
  taxNameAr: string;
  paidCents: number;
  /** Cash handed over and change, from the latest payment. */
  tenderedCents: number;
  changeCents: number;
  status: OrderStatus;
  phone: string;
  address: string;
  footer: string;
}

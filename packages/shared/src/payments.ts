import { type Cents, cents } from "./money.js";
import { percentOf } from "./totals.js";

// Mobile wallet payments and coupons (docs/milestones/m8-wallets-coupons.md).

/** A wallet the restaurant takes, from the "wallets" setting. The key never changes; the name can. */
export interface Wallet {
  key: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
}

/** How the customer pays one part of the bill. */
export type Tender = { method: "cash"; tenderedPounds: number } | { method: "wallet"; wallet: string; amountPounds: number; reference: string };

/**
 * What a payment or refund event carries in its `data`. Events from before
 * wallets have only `method: "cash"`, or nothing, which also means cash.
 */
export interface PaymentRef {
  method: "cash" | "wallet";
  /** The wallet's key and its name at the time, so a later rename leaves history alone. */
  wallet?: string;
  walletName?: string;
  reference?: string;
}

export function paymentOf(data: unknown): PaymentRef {
  const d = data as Partial<PaymentRef> | null;
  if (d?.method === "wallet" && typeof d.wallet === "string") {
    return { method: "wallet", wallet: d.wallet, walletName: d.walletName ?? d.wallet, ...(d.reference ? { reference: d.reference } : {}) };
  }
  return { method: "cash" };
}

/** The coupon behind a discount event, if it came from one. */
export function couponOf(data: unknown): { couponId: string; code: string } | null {
  const d = data as { source?: string; code?: string; couponId?: string } | null;
  return d?.source === "coupon" && typeof d.code === "string" ? { couponId: d.couponId ?? "", code: d.code } : null;
}

export interface CouponRule {
  percentBp: number | null;
  amountCents: number | null;
  /** The last business day it works on (YYYY-MM-DD), or null. */
  endsOn: string | null;
  maxUses: number | null;
  active: boolean;
}

export type CouponRefusal = "inactive" | "expired" | "used_up";

/** Codes are kept in capitals, so the cashier can type them in any case. */
export const couponCode = (code: string) => code.trim().toUpperCase();

/** Why a coupon can't be used today, or null if it can. `uses` counts the other orders already using it. */
export function couponRefusal(c: CouponRule, businessDate: string, uses: number): CouponRefusal | null {
  if (!c.active) return "inactive";
  if (c.endsOn !== null && businessDate > c.endsOn) return "expired";
  if (c.maxUses !== null && uses >= c.maxUses) return "used_up";
  return null;
}

/** What a coupon takes off the food, never more than the food itself. */
export function couponAmount(c: CouponRule, subtotalCents: number): Cents {
  const off = c.percentBp !== null ? percentOf(subtotalCents, c.percentBp) : (c.amountCents ?? 0);
  return cents(Math.min(off, subtotalCents));
}

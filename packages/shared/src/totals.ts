import { type Cents, cents } from "./money.js";

// What an order owes, worked out from its lines and its money events. The
// balance is never stored, so it cannot drift from the events
// (docs/milestones/m4-pay-and-print.md).

export type MoneyEvent =
  | { kind: "discount"; amountCents: number }
  | { kind: "delivery_fee"; amountCents: number }
  | { kind: "payment"; amountCents: number }
  | { kind: "refund"; amountCents: number }
  | { kind: "void" };

export type OrderStatus = "unpaid" | "part_paid" | "paid" | "voided" | "refunded";

export interface OrderTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  deliveryFeeCents: Cents;
  /** What the food comes to after the discount: the restaurant's sale. The delivery fee goes to the driver. */
  foodCents: Cents;
  totalCents: Cents;
  /** Tax already inside the food price (prices include it); shown, never added. Not charged on the delivery fee. */
  taxIncludedCents: Cents;
  paidCents: Cents;
  balanceCents: Cents;
  status: OrderStatus;
}

const POUND = 100;

/** Rounds cents to whole pounds, half up. Works for non-negative values. */
export function roundToPound(value: number): Cents {
  return cents(Math.floor((2 * value + POUND) / (2 * POUND)) * POUND);
}

/** A % discount on the subtotal, in basis points (10% = 1000), rounded to whole pounds. */
export function percentOf(subtotalCents: number, percentBp: number): Cents {
  if (!Number.isInteger(percentBp) || percentBp < 0 || percentBp > 10_000) throw new RangeError(`bad percent ${percentBp}`);
  // Whole pounds: (subtotal × bp / 10,000) rounded half up, in integers only.
  const num = subtotalCents * percentBp;
  const per = POUND * 10_000;
  return cents(Math.floor((2 * num + per) / (2 * per)) * POUND);
}

/** The tax inside a tax-inclusive total: total × rate / (1 + rate), rounded to whole pounds. */
export function includedTax(totalCents: number, rateBp: number): Cents {
  if (!Number.isInteger(rateBp) || rateBp < 0) throw new RangeError(`bad tax rate ${rateBp}`);
  const num = totalCents * rateBp;
  const den = 10_000 + rateBp;
  return cents(Math.floor((2 * num + den * POUND) / (2 * den * POUND)) * POUND);
}

/** The latest discount and delivery fee count; payments and refunds add up. */
export function orderTotals(subtotalCents: number, events: MoneyEvent[], taxRateBp: number): OrderTotals {
  let discount = 0;
  let fee = 0;
  let paid = 0;
  let refunded = 0;
  let voided = false;
  for (const e of events) {
    if (e.kind === "discount") discount = e.amountCents;
    else if (e.kind === "delivery_fee") fee = e.amountCents;
    else if (e.kind === "payment") paid += e.amountCents;
    else if (e.kind === "refund") refunded += e.amountCents;
    else voided = true;
  }
  discount = Math.min(discount, subtotalCents);
  const food = subtotalCents - discount;
  const total = food + fee;
  const net = paid - refunded;

  let status: OrderStatus;
  if (voided) status = "voided";
  else if (refunded > 0 && net <= 0) status = "refunded";
  else if (net >= total) status = "paid";
  else if (net > 0) status = "part_paid";
  else status = "unpaid";

  return {
    subtotalCents: cents(subtotalCents),
    discountCents: cents(discount),
    deliveryFeeCents: cents(fee),
    foodCents: cents(food),
    totalCents: cents(total),
    taxIncludedCents: includedTax(food, taxRateBp),
    paidCents: cents(net),
    balanceCents: cents(status === "voided" || status === "refunded" ? 0 : Math.max(0, total - net)),
    status,
  };
}

/** Cash handed over: what goes against the balance and the change to give back. */
export function cashTender(balanceCents: number, tenderedCents: number): { appliedCents: Cents; changeCents: Cents } {
  if (!Number.isSafeInteger(tenderedCents) || tenderedCents <= 0) throw new RangeError(`bad tender ${tenderedCents}`);
  const applied = Math.min(balanceCents, tenderedCents);
  return { appliedCents: cents(applied), changeCents: cents(tenderedCents - applied) };
}

import { describe, expect, it } from "vitest";
import { cashTender, includedTax, orderTotals, percentOf, roundToPound } from "./totals.js";

const syp = (pounds: number) => pounds * 100;
const FIVE_PERCENT = 500;

describe("includedTax", () => {
  it("finds the 5% already inside the price", () => {
    // 3,250 × 5 / 105 = 154.76… → 155
    expect(includedTax(syp(3250), FIVE_PERCENT)).toBe(syp(155));
    // 2,100 × 5 / 105 = 100 exactly
    expect(includedTax(syp(2100), FIVE_PERCENT)).toBe(syp(100));
  });

  it("is 0 at a 0% rate", () => {
    expect(includedTax(syp(1000), 0)).toBe(0);
  });

  it("rounds a half pound up", () => {
    // 21 × 5 / 105 = 1, 31.5 → 1.5 → 2
    expect(includedTax(syp(31.5), FIVE_PERCENT)).toBe(syp(2));
  });
});

describe("percentOf", () => {
  it("takes 10% off in whole pounds", () => {
    expect(percentOf(syp(3250), 1000)).toBe(syp(325));
    expect(percentOf(syp(955), 1000)).toBe(syp(96)); // 95.5 → 96
  });

  it("refuses more than 100%", () => {
    expect(() => percentOf(syp(100), 10_001)).toThrow(RangeError);
  });
});

describe("roundToPound", () => {
  it("rounds half up", () => {
    expect(roundToPound(150)).toBe(200);
    expect(roundToPound(149)).toBe(100);
  });
});

describe("orderTotals", () => {
  it("starts unpaid with the lines' total", () => {
    expect(orderTotals(syp(3250), [], FIVE_PERCENT)).toEqual({
      subtotalCents: syp(3250),
      discountCents: 0,
      deliveryFeeCents: 0,
      totalCents: syp(3250),
      taxIncludedCents: syp(155),
      paidCents: 0,
      balanceCents: syp(3250),
      status: "unpaid",
    });
  });

  it("applies the latest discount and delivery fee", () => {
    const t = orderTotals(
      syp(3000),
      [
        { kind: "discount", amountCents: syp(500) },
        { kind: "delivery_fee", amountCents: syp(300) },
        { kind: "discount", amountCents: syp(300) },
      ],
      FIVE_PERCENT,
    );
    expect(t.totalCents).toBe(syp(3000));
    expect(t.discountCents).toBe(syp(300));
  });

  it("never discounts below zero", () => {
    expect(orderTotals(syp(100), [{ kind: "discount", amountCents: syp(500) }], 0).totalCents).toBe(0);
  });

  it("tracks part and full payment", () => {
    expect(orderTotals(syp(1000), [{ kind: "payment", amountCents: syp(400) }], 0)).toMatchObject({ status: "part_paid", balanceCents: syp(600) });
    expect(
      orderTotals(
        syp(1000),
        [
          { kind: "payment", amountCents: syp(400) },
          { kind: "payment", amountCents: syp(600) },
        ],
        0,
      ),
    ).toMatchObject({ status: "paid", balanceCents: 0 });
  });

  it("shows voided and refunded orders with nothing owed", () => {
    expect(orderTotals(syp(1000), [{ kind: "void" }], 0)).toMatchObject({ status: "voided", balanceCents: 0 });
    expect(
      orderTotals(
        syp(1000),
        [
          { kind: "payment", amountCents: syp(1000) },
          { kind: "refund", amountCents: syp(1000) },
        ],
        0,
      ),
    ).toMatchObject({ status: "refunded", paidCents: 0, balanceCents: 0 });
  });
});

describe("cashTender", () => {
  it("gives change from a larger note", () => {
    expect(cashTender(syp(3250), syp(5000))).toEqual({ appliedCents: syp(3250), changeCents: syp(1750) });
  });

  it("takes part of the bill when the cash is short", () => {
    expect(cashTender(syp(3250), syp(2000))).toEqual({ appliedCents: syp(2000), changeCents: 0 });
  });

  it("refuses zero or fractional cash", () => {
    expect(() => cashTender(syp(100), 0)).toThrow(RangeError);
    expect(() => cashTender(syp(100), 1.5)).toThrow(RangeError);
  });
});

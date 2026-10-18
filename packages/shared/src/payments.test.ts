import { describe, expect, it } from "vitest";
import { couponAmount, couponCode, couponRefusal, paymentOf } from "./payments.js";

const tenPercent = { percentBp: 1_000, amountCents: null, endsOn: null, maxUses: null, active: true };

describe("coupons", () => {
  it("keeps codes in capitals without spaces around them", () => {
    expect(couponCode("  pizza10 ")).toBe("PIZZA10");
  });

  it("takes a percent or a fixed amount off the food, never more than the food", () => {
    // 10% of 1,455 = 145.5 → 146 whole pounds.
    expect(couponAmount(tenPercent, 145_500)).toBe(14_600);
    expect(couponAmount({ ...tenPercent, percentBp: null, amountCents: 50_000 }, 120_000)).toBe(50_000);
    expect(couponAmount({ ...tenPercent, percentBp: null, amountCents: 50_000 }, 30_000)).toBe(30_000);
  });

  it("refuses a coupon that is off, past its last day or used up", () => {
    expect(couponRefusal(tenPercent, "2026-10-18", 1_000)).toBeNull();
    expect(couponRefusal({ ...tenPercent, active: false }, "2026-10-18", 0)).toBe("inactive");
    expect(couponRefusal({ ...tenPercent, endsOn: "2026-10-18" }, "2026-10-18", 0)).toBeNull();
    expect(couponRefusal({ ...tenPercent, endsOn: "2026-10-17" }, "2026-10-18", 0)).toBe("expired");
    expect(couponRefusal({ ...tenPercent, maxUses: 2 }, "2026-10-18", 1)).toBeNull();
    expect(couponRefusal({ ...tenPercent, maxUses: 2 }, "2026-10-18", 2)).toBe("used_up");
  });
});

describe("paymentOf", () => {
  it("reads a wallet payment, and treats anything else as cash", () => {
    expect(paymentOf({ method: "wallet", wallet: "syriatel", walletName: "سيريتل كاش", reference: "123" })).toEqual({
      method: "wallet",
      wallet: "syriatel",
      walletName: "سيريتل كاش",
      reference: "123",
    });
    expect(paymentOf({ method: "cash" })).toEqual({ method: "cash" });
    expect(paymentOf({})).toEqual({ method: "cash" });
    expect(paymentOf(null)).toEqual({ method: "cash" });
  });
});

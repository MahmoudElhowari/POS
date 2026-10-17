import { describe, expect, it } from "vitest";
import { addCents, cents } from "./money.js";

describe("money", () => {
  it("adds integer cents exactly", () => {
    expect(addCents(cents(10), cents(20))).toBe(30);
  });

  it("rejects fractional cents", () => {
    expect(() => cents(0.1)).toThrow(RangeError);
  });
});

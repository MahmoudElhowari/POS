import { describe, expect, it } from "vitest";
import { formatSyp } from "./format.js";
import { cents } from "./money.js";

describe("formatSyp", () => {
  it("formats whole pounds with thousands separators", () => {
    expect(formatSyp(cents(1_250_000))).toBe("12,500 ل.س");
  });

  it("shows piastres only when present", () => {
    expect(formatSyp(cents(1_050))).toBe("10.50 ل.س");
  });
});

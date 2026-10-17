import { describe, expect, it } from "vitest";
import { cashSuggestions, parsePercentBp, parsePounds, percentText, pounds } from "./format";

describe("money formatting", () => {
  it("shows whole pounds with separators", () => {
    expect(pounds(180_000)).toBe("1,800");
  });

  it("reads Western or Eastern Arabic digits", () => {
    expect(parsePounds("1,800")).toBe(1800);
    expect(parsePounds("١٨٠٠")).toBe(1800);
    expect(parsePounds("")).toBeNull();
    expect(parsePounds("18.5")).toBeNaN();
  });
});

describe("percents", () => {
  it("reads a typed percent as basis points", () => {
    expect(parsePercentBp("5")).toBe(500);
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("٥")).toBe(500);
    expect(parsePercentBp("0.05")).toBe(5);
    expect(parsePercentBp("")).toBeNull();
    expect(parsePercentBp("5.555")).toBeNaN();
    expect(parsePercentBp("abc")).toBeNaN();
  });

  it("shows basis points as a percent", () => {
    expect([500, 550, 1250, 5].map(percentText)).toEqual(["5", "5.5", "12.5", "0.05"]);
  });
});

describe("cashSuggestions", () => {
  it("offers the exact amount and the next round notes", () => {
    expect(cashSuggestions(3225)).toEqual([3225, 3500, 4000, 5000]);
    expect(cashSuggestions(5000)).toEqual([5000]);
  });
});

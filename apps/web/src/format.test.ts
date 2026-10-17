import { describe, expect, it } from "vitest";
import { parsePounds, pounds } from "./format";

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

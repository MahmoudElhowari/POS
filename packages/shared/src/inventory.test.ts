import { describe, expect, it } from "vitest";
import { parseQty, qtyText, type StockLinkRule, stockUsed } from "./inventory.js";

const links: StockLinkRule[] = [
  { stockItemId: "can", itemId: "soda", categoryKind: null, sizeKey: "can", qty: 1, takeawayOnly: false },
  { stockItemId: "box-reg", itemId: null, categoryKind: "pizza", sizeKey: "regular", qty: 1, takeawayOnly: true },
  { stockItemId: "box-reg", itemId: null, categoryKind: "calzone", sizeKey: null, qty: 1, takeawayOnly: true },
  { stockItemId: "box-big", itemId: null, categoryKind: "pizza", sizeKey: "large", qty: 1, takeawayOnly: true },
];

describe("stockUsed", () => {
  const lines = [
    { itemId: "sultan", categoryKind: "pizza" as const, sizeKey: "large", qty: 2 },
    { itemId: "corn", categoryKind: "pizza" as const, sizeKey: "regular", qty: 1 },
    { itemId: "calzone", categoryKind: "calzone" as const, sizeKey: "one", qty: 1 },
    { itemId: "soda", categoryKind: "other" as const, sizeKey: "can", qty: 3 },
    { itemId: "soda", categoryKind: "other" as const, sizeKey: "1l", qty: 1 },
  ];

  it("takes a box per pizza and calzone, by size, and the linked drinks", () => {
    expect(Object.fromEntries(stockUsed(lines, links, "delivery"))).toEqual({ "box-big": 2, "box-reg": 2, can: 3 });
  });

  it("uses no boxes for dine-in", () => {
    expect(Object.fromEntries(stockUsed(lines, links, "dine_in"))).toEqual({ can: 3 });
  });
});

describe("quantities", () => {
  it("reads kg and litres as whole grams and millilitres, and pieces as whole numbers", () => {
    expect(parseQty("1.25", "g")).toBe(1_250);
    expect(parseQty("٢٫٥", "ml")).toBe(2_500);
    expect(parseQty("0.005", "g")).toBe(5);
    expect(parseQty("12", "piece")).toBe(12);
    expect(parseQty("", "g")).toBeNull();
    expect(parseQty("1.5", "piece")).toBeNaN();
    expect(parseQty("1.2345", "g")).toBeNaN();
    expect(parseQty("-3", "piece")).toBeNaN();
  });

  it("shows them back the same way", () => {
    expect([1_250, 5, 2_000, 0, -750].map((q) => qtyText(q, "g"))).toEqual(["1.25", "0.005", "2", "0", "-0.75"]);
    expect(qtyText(12, "piece")).toBe("12");
  });
});

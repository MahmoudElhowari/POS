import { describe, expect, it } from "vitest";
import { bulkChange, MAX_CRUST_STUFFINGS, type PricingAddon, type PricingItem, priceLine } from "./pricing.js";

const syp = (pounds: number) => pounds * 100;
const pizza = (id: string, regular: number | null, large: number | null, includedAddons: string[] = []): PricingItem => ({
  id,
  halfAndHalf: true,
  includedAddons,
  sizes: [
    { sizeKey: "regular", priceCents: regular === null ? null : syp(regular) },
    { sizeKey: "large", priceCents: large === null ? null : syp(large) },
  ],
});

// Real prices from the Romantica menu photos (2026-10-17).
const margherita = pizza("margherita", 900, 1800);
const sultan = pizza("sultan", 1100, 2200, ["sujuq"]);
const friends = pizza("friends", 1000, 2000, ["cheese", "sujuq"]);
const calzone: PricingItem = { id: "calzone", halfAndHalf: false, includedAddons: [], sizes: [{ sizeKey: "one", priceCents: syp(750) }] };
const fries: PricingItem = {
  id: "fries",
  halfAndHalf: false,
  includedAddons: [],
  sizes: [
    { sizeKey: "regular", priceCents: syp(300) },
    { sizeKey: "large", priceCents: syp(400) },
  ],
};

const catalog: PricingAddon[] = [
  { key: "cheese", group: "crust_stuffing", prices: { regular: syp(200), large: syp(400) } },
  { key: "sujuq", group: "crust_stuffing", prices: { regular: syp(250), large: syp(500) } },
  { key: "hotdog", group: "crust_stuffing", prices: { regular: syp(250), large: syp(500) } },
  { key: "double_cheese", group: "extra", prices: { regular: syp(150), large: syp(300) } },
];

const price = (input: Parameters<typeof priceLine>[0]) => priceLine(input, catalog);

describe("priceLine", () => {
  it("prices one pizza at its size", () => {
    expect(price({ item: margherita, sizeKey: "large" }).unitCents).toBe(syp(1800));
    expect(price({ item: margherita, sizeKey: "regular" }).unitCents).toBe(syp(900));
  });

  it("prices half-and-half at the more expensive half", () => {
    const line = price({ item: margherita, otherHalf: sultan, sizeKey: "large" });
    expect(line.unitCents).toBe(syp(2200));
    expect(line.parts[0]).toEqual({ kind: "base", key: "sultan", cents: syp(2200) });
  });

  it("gives the same price whichever half comes first", () => {
    expect(price({ item: sultan, otherHalf: margherita, sizeKey: "regular" }).unitCents).toBe(
      price({ item: margherita, otherHalf: sultan, sizeKey: "regular" }).unitCents,
    );
  });

  it("refuses half-and-half with a calzone", () => {
    expect(() => price({ item: margherita, otherHalf: calzone, sizeKey: "regular" })).toThrow(/not_half_and_half/);
  });

  it("refuses a half whose size has no price yet", () => {
    expect(() => price({ item: margherita, otherHalf: pizza("new", null, 2000), sizeKey: "regular" })).toThrow(/size_not_sold/);
  });

  it("adds one or two crust stuffings at their size price", () => {
    expect(price({ item: margherita, sizeKey: "large", addons: ["cheese"] }).unitCents).toBe(syp(1800 + 400));
    expect(price({ item: margherita, sizeKey: "large", addons: ["cheese", "sujuq"] }).unitCents).toBe(syp(1800 + 400 + 500));
  });

  it(`allows at most ${MAX_CRUST_STUFFINGS} stuffings`, () => {
    expect(() => price({ item: margherita, sizeKey: "large", addons: ["cheese", "sujuq", "hotdog"] })).toThrow(/too_many_stuffings/);
  });

  it("does not count Double Cheese as a stuffing", () => {
    const line = price({ item: margherita, sizeKey: "regular", addons: ["cheese", "sujuq", "double_cheese"] });
    expect(line.unitCents).toBe(syp(900 + 200 + 250 + 150));
  });

  it("keeps a built-in crust in the price and does not let it change", () => {
    expect(price({ item: friends, sizeKey: "large" }).unitCents).toBe(syp(2000));
    expect(() => price({ item: friends, sizeKey: "large", addons: ["hotdog"] })).toThrow(/crust_built_in/);
    expect(price({ item: friends, sizeKey: "large", addons: ["double_cheese"] }).unitCents).toBe(syp(2300));
  });

  it("keeps a built-in crust when that pizza is one half", () => {
    expect(() => price({ item: margherita, otherHalf: sultan, sizeKey: "large", addons: ["cheese"] })).toThrow(/crust_built_in/);
  });

  it("refuses the same add-on twice", () => {
    expect(() => price({ item: margherita, sizeKey: "large", addons: ["cheese", "cheese"] })).toThrow(/duplicate_addon/);
  });

  it("refuses an add-on that is unavailable or has no price", () => {
    const off: PricingAddon[] = [{ key: "cheese", group: "crust_stuffing", available: false, prices: { large: syp(400) } }];
    expect(() => priceLine({ item: margherita, sizeKey: "large", addons: ["cheese"] }, off)).toThrow(/addon_not_sold/);
    const unpriced: PricingAddon[] = [{ key: "cheese", group: "crust_stuffing", prices: { large: null } }];
    expect(() => priceLine({ item: margherita, sizeKey: "large", addons: ["cheese"] }, unpriced)).toThrow(/addon_not_sold/);
  });

  it("charges nothing for removed ingredients and keeps them for the kitchen", () => {
    const line = price({ item: margherita, sizeKey: "regular", removals: ["بصل"] });
    expect(line.unitCents).toBe(syp(900));
    expect(line.removals).toEqual(["بصل"]);
  });

  it("multiplies the unit price, add-ons included, by quantity", () => {
    const line = price({ item: margherita, sizeKey: "large", addons: ["cheese"], qty: 3 });
    expect(line.totalCents).toBe(syp(3 * (1800 + 400)));
  });

  it("rejects zero or fractional quantities", () => {
    expect(() => price({ item: fries, sizeKey: "large", qty: 0 })).toThrow(/bad_quantity/);
    expect(() => price({ item: fries, sizeKey: "large", qty: 1.5 })).toThrow(/bad_quantity/);
  });

  it("refuses an unavailable item or size", () => {
    expect(() => price({ item: { ...fries, available: false }, sizeKey: "large" })).toThrow(/item_unavailable/);
    const noLarge = { ...fries, sizes: fries.sizes.map((s) => ({ ...s, available: s.sizeKey !== "large" })) };
    expect(() => price({ item: noLarge, sizeKey: "large" })).toThrow(/size_not_sold/);
  });
});

describe("bulkChange", () => {
  it("raises by a percentage and rounds to whole pounds", () => {
    expect(bulkChange(syp(1800), 700)).toBe(syp(1926));
    expect(bulkChange(syp(750), 1000)).toBe(syp(825));
    expect(bulkChange(syp(40), 333)).toBe(syp(41)); // 41.332
  });

  it("rounds a half pound up", () => {
    expect(bulkChange(syp(15), 1000)).toBe(syp(17)); // 16.5
  });

  it("can lower prices", () => {
    expect(bulkChange(syp(1000), -500)).toBe(syp(950));
  });

  it("leaves prices alone at 0%", () => {
    expect(bulkChange(syp(2200), 0)).toBe(syp(2200));
  });

  it("refuses -100% or a fractional basis point", () => {
    expect(() => bulkChange(syp(100), -10_000)).toThrow(RangeError);
    expect(() => bulkChange(syp(100), 1.5)).toThrow(RangeError);
  });
});

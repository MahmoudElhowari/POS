import { type Cents, cents } from "./money.js";

// Pure pricing rules for a pizza or any other menu line (agreed 2026-10-17,
// see docs/milestones/m2-menu-engine.md). No I/O, integer cents only.

export interface PricingSize {
  sizeKey: string;
  priceCents: number | null;
  available?: boolean;
}

export interface PricingItem {
  id: string;
  halfAndHalf: boolean;
  available?: boolean;
  sizes: PricingSize[];
  /** Addon keys built into the item's price (e.g. Friends: cheese + sujuq crust). */
  includedAddons: string[];
}

export interface PricingAddon {
  key: string;
  group: "crust_stuffing" | "extra";
  available?: boolean;
  /** Price per size key; null or missing means not sold for that size. */
  prices: Record<string, number | null>;
}

export interface LineInput {
  item: PricingItem;
  sizeKey: string;
  /** Second half of a half-and-half pizza. */
  otherHalf?: PricingItem;
  addons?: string[];
  /** Ingredients left out ("no onion"): free, carried to the kitchen ticket. */
  removals?: string[];
  qty?: number;
}

export interface LinePart {
  kind: "base" | "addon";
  key: string;
  cents: Cents;
}

export interface PricedLine {
  unitCents: Cents;
  totalCents: Cents;
  qty: number;
  parts: LinePart[];
  removals: string[];
}

export const MAX_CRUST_STUFFINGS = 2;

export type PricingErrorCode =
  | "size_not_sold"
  | "not_half_and_half"
  | "addon_not_sold"
  | "duplicate_addon"
  | "too_many_stuffings"
  | "crust_built_in"
  | "bad_quantity"
  | "item_unavailable";

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

function sizePrice(item: PricingItem, sizeKey: string): Cents {
  if (item.available === false) throw new PricingError("item_unavailable", item.id);
  const size = item.sizes.find((s) => s.sizeKey === sizeKey);
  if (!size || size.priceCents === null || size.available === false) {
    throw new PricingError("size_not_sold", `${item.id} ${sizeKey}`);
  }
  return cents(size.priceCents);
}

export function priceLine(input: LineInput, catalog: PricingAddon[]): PricedLine {
  const { item, sizeKey, otherHalf, addons = [], removals = [], qty = 1 } = input;
  if (!Number.isInteger(qty) || qty < 1) throw new PricingError("bad_quantity", String(qty));

  // Half-and-half: the more expensive half sets the price.
  let base = sizePrice(item, sizeKey);
  let baseKey = item.id;
  if (otherHalf) {
    if (!item.halfAndHalf || !otherHalf.halfAndHalf) {
      throw new PricingError("not_half_and_half", `${item.id} / ${otherHalf.id}`);
    }
    const other = sizePrice(otherHalf, sizeKey);
    if (other > base) {
      base = other;
      baseKey = otherHalf.id;
    }
  }

  const builtIn = new Set([...item.includedAddons, ...(otherHalf?.includedAddons ?? [])]);
  const builtInStuffing = [...builtIn].some((k) => catalog.find((a) => a.key === k)?.group === "crust_stuffing");

  const parts: LinePart[] = [{ kind: "base", key: baseKey, cents: base }];
  const seen = new Set<string>();
  let stuffings = 0;
  for (const key of addons) {
    if (seen.has(key)) throw new PricingError("duplicate_addon", key);
    seen.add(key);
    const addon = catalog.find((a) => a.key === key);
    const price = addon?.prices[sizeKey];
    if (!addon || addon.available === false || price === null || price === undefined) {
      throw new PricingError("addon_not_sold", `${key} ${sizeKey}`);
    }
    if (addon.group === "crust_stuffing") {
      if (builtInStuffing) throw new PricingError("crust_built_in", key);
      if (++stuffings > MAX_CRUST_STUFFINGS) throw new PricingError("too_many_stuffings", key);
    }
    parts.push({ kind: "addon", key, cents: cents(price) });
  }

  const unit = cents(parts.reduce((sum, p) => sum + p.cents, 0));
  return { unitCents: unit, totalCents: cents(unit * qty), qty, parts, removals: [...removals] };
}

/** Whole-pound rounding of a bulk % change, half rounds up. percentBp: +7% = 700. */
export function bulkChange(priceCents: number, percentBp: number): Cents {
  if (!Number.isInteger(percentBp) || percentBp <= -10_000) throw new RangeError(`bad percent ${percentBp}`);
  const num = priceCents * (10_000 + percentBp); // cents × 10,000
  const perPound = 100 * 10_000;
  const pounds = Math.floor((2 * num + perPound) / (2 * perPound));
  return cents(pounds * 100);
}

import type { OrderType } from "./order.js";

// Basic inventory (docs/milestones/m9-basic-inventory.md). Quantities are whole
// grams, millilitres or pieces, never floats, like money in cents.

export type StockUnit = "g" | "ml" | "piece";
export type StockMoveKind = "delivery" | "count" | "waste" | "sale" | "void";
export type CategoryKind = "pizza" | "calzone" | "other";

/** A ready-made good a sale uses: for one menu item, or for every item of a kind (a box per pizza). */
export interface StockLinkRule {
  stockItemId: string;
  itemId: string | null;
  categoryKind: CategoryKind | null;
  /** null means any size. */
  sizeKey: string | null;
  qty: number;
  takeawayOnly: boolean;
}

export interface SoldLine {
  itemId: string;
  categoryKind: CategoryKind;
  sizeKey: string;
  qty: number;
}

/** What an order uses up, by stock item. Dine-in orders use no boxes. */
export function stockUsed(lines: SoldLine[], links: StockLinkRule[], type: OrderType): Map<string, number> {
  const used = new Map<string, number>();
  for (const line of lines) {
    for (const link of links) {
      if (link.takeawayOnly && type === "dine_in") continue;
      const target = link.itemId !== null ? link.itemId === line.itemId : link.categoryKind === line.categoryKind;
      if (!target || (link.sizeKey !== null && link.sizeKey !== line.sizeKey)) continue;
      used.set(link.stockItemId, (used.get(link.stockItemId) ?? 0) + link.qty * line.qty);
    }
  }
  return used;
}

/** The unit the screen shows: kg for grams, litres for millilitres. */
const SCALE: Record<StockUnit, number> = { g: 1000, ml: 1000, piece: 1 };

/**
 * Reads what someone typed ("1.25" kg, "3" pieces) as whole base units (1,250 g),
 * without floats. Null when empty, NaN when it isn't a number in that unit.
 */
export function parseQty(text: string, unit: StockUnit): number | null {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, ".");
  if (!clean) return null;
  const decimals = unit === "piece" ? 0 : 3;
  const match = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(clean);
  if (!match || (decimals === 0 && match[2] !== undefined)) return Number.NaN;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? "").padEnd(decimals, "0") || "0");
  return whole * SCALE[unit] + frac;
}

/** Base units as the screen shows them: 1,250 g → "1.25", 3 pieces → "3". */
export function qtyText(qty: number, unit: StockUnit): string {
  const scale = SCALE[unit];
  if (scale === 1) return String(qty);
  const sign = qty < 0 ? "-" : "";
  const abs = Math.abs(qty);
  const frac = String(abs % scale)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${sign}${Math.trunc(abs / scale)}${frac ? `.${frac}` : ""}`;
}

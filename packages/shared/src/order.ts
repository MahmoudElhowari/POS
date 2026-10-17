import { type Cents, cents } from "./money.js";
import { type PricedLine, type PricingAddon, type PricingItem, priceLine } from "./pricing.js";

// An order being built on the order screen, and how it is priced and checked.
// The screen and the API run the same code, so the total the cashier sees is
// the total the server saves (docs/milestones/m3-order-entry.md).

export const ORDER_TYPES = ["dine_in", "pickup", "delivery"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const TABLES = [1, 2, 3, 4, 5, 6] as const;

export interface DraftCustomer {
  name: string;
  phone?: string | undefined;
  area?: string | undefined;
  directions?: string | undefined;
}

export interface DraftLine {
  itemId: string;
  sizeKey: string;
  otherHalfId?: string | undefined;
  addons: string[];
  /** Arabic names of the ingredients left out, as listed on the item. */
  removals: string[];
  note?: string | undefined;
  qty: number;
}

export interface OrderDraft {
  type: OrderType;
  tableNo?: number | undefined;
  customer: DraftCustomer;
  note?: string | undefined;
  lines: DraftLine[];
}

/** The parts of the sellable menu (GET /menu) that pricing needs. */
export interface SellableMenu {
  categories: {
    kind: "pizza" | "calzone" | "other";
    items: {
      id: string;
      halfAndHalf: boolean;
      removable: { ar: string; en: string }[];
      includedAddons: string[];
      sizes: { sizeKey: string; priceCents: number }[];
    }[];
  }[];
  addons: { key: string; group: "crust_stuffing" | "extra"; prices: Record<string, number> }[];
}

export type DraftProblem =
  | { code: "no_lines" }
  | { code: "no_customer_name" }
  | { code: "no_table" }
  | { code: "bad_table" }
  | { code: "item_unavailable"; line: number }
  | { code: "bad_removal"; line: number }
  | { code: "pricing"; line: number; detail: string };

export interface PricedDraftLine extends PricedLine {
  line: DraftLine;
}

export interface PricedDraft {
  lines: PricedDraftLine[];
  totalCents: Cents;
}

/** Checks the order header: who it is for and where it goes. */
export function headerProblems(draft: OrderDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.lines.length) problems.push({ code: "no_lines" });
  if (!draft.customer.name.trim()) problems.push({ code: "no_customer_name" });
  if (draft.type === "dine_in") {
    if (draft.tableNo === undefined) problems.push({ code: "no_table" });
    else if (!(TABLES as readonly number[]).includes(draft.tableNo)) problems.push({ code: "bad_table" });
  }
  return problems;
}

/** Prices every line against the menu as it is now. Problems are per line. */
export function priceDraft(draft: OrderDraft, menu: SellableMenu): { priced: PricedDraft | null; problems: DraftProblem[] } {
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i] as const)));
  const catalog: PricingAddon[] = menu.addons.map((a) => ({ key: a.key, group: a.group, prices: a.prices }));
  const toPricing = (i: SellableMenu["categories"][number]["items"][number]): PricingItem => ({
    id: i.id,
    halfAndHalf: i.halfAndHalf,
    includedAddons: i.includedAddons,
    sizes: i.sizes,
  });

  const problems: DraftProblem[] = [];
  const lines: PricedDraftLine[] = [];
  draft.lines.forEach((line, index) => {
    const item = items.get(line.itemId);
    const other = line.otherHalfId === undefined ? undefined : items.get(line.otherHalfId);
    if (!item || (line.otherHalfId !== undefined && !other)) {
      problems.push({ code: "item_unavailable", line: index });
      return;
    }
    const removable = new Set([...item.removable, ...(other?.removable ?? [])].map((r) => r.ar));
    if (line.removals.some((r) => !removable.has(r))) {
      problems.push({ code: "bad_removal", line: index });
      return;
    }
    try {
      const priced = priceLine(
        {
          item: toPricing(item),
          sizeKey: line.sizeKey,
          ...(other ? { otherHalf: toPricing(other) } : {}),
          addons: line.addons,
          removals: line.removals,
          qty: line.qty,
        },
        catalog,
      );
      lines.push({ ...priced, line });
    } catch (err) {
      problems.push({ code: "pricing", line: index, detail: (err as Error).message });
    }
  });

  if (problems.length) return { priced: null, problems };
  return { priced: { lines, totalCents: cents(lines.reduce((sum, l) => sum + l.totalCents, 0)) }, problems };
}

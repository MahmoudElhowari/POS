import type { StockUnit } from "./inventory.js";
import type { OrderType } from "./order.js";
import { ORDER_TYPES } from "./order.js";
import type { OrderTotals } from "./totals.js";

// The reports dashboard (docs/milestones/m10-reports-dashboard.md). It counts
// like the Z: sales on the business day an order was sent, voided orders left
// out; payments, refunds and voids on the day they happened.

/** A sent order in the period, with the clock hour (store time) it was sent. */
export interface DashboardOrder {
  type: OrderType;
  businessDate: string;
  hour: number;
  totals: OrderTotals;
  lines: { qty: number; nameAr: string; sizeAr: string | null; otherHalfAr: string | null; categoryAr: string; totalCents: number }[];
}

export interface DashboardEvent {
  kind: "payment" | "refund" | "void";
  amountCents: number;
  /** Missing means cash (before Milestone 8). */
  method?: "cash" | "wallet";
  walletName?: string | null;
}

export interface StockDelivery {
  nameAr: string;
  unit: StockUnit;
  qty: number;
  /** Null when no price was typed. */
  costCents: number | null;
}

export interface DashboardInput {
  from: string;
  to: string;
  orders: DashboardOrder[];
  events: DashboardEvent[];
  /** Business days the restaurant opened in the period. */
  openDates: string[];
  stock: StockDelivery[];
}

export interface Headline {
  /** Food after discounts, without delivery fees: the restaurant's sales. */
  salesCents: number;
  orders: number;
  /** Sales per order, rounded down to whole cents. */
  averageCents: number;
  discountCents: number;
  refundCents: number;
  voids: number;
}

export interface Dashboard {
  from: string;
  to: string;
  headline: Headline;
  byType: { type: OrderType; count: number; salesCents: number }[];
  /** Cash first, then each wallet by amount. A null name is cash. */
  byMethod: { walletName: string | null; count: number; amountCents: number }[];
  /** All 24 clock hours, 0 to 23. */
  hours: { hour: number; orders: number; salesCents: number }[];
  /** Every date in the period, oldest first. */
  days: { date: string; orders: number; salesCents: number }[];
  /** Sunday first. Only for periods of 7 days or more. */
  weekdays: { weekday: number; openDays: number; salesCents: number; averageCents: number }[];
  /** Item sales are line prices before order discounts; a half-and-half gives half to each side. */
  items: { nameAr: string; sizeAr: string | null; categoryAr: string; halves: number; salesCents: number; shareBp: number }[];
  categories: { nameAr: string; halves: number; salesCents: number; shareBp: number }[];
  itemsTotalCents: number;
  stock: { totalCents: number; items: { nameAr: string; unit: StockUnit; qty: number; deliveries: number; costCents: number }[] };
}

export interface DashboardView {
  /** The open business day, for the period buttons. */
  today: string;
  /** The cut-off hour a business day starts at, so the hour chart starts there too. */
  dayStartHour: number;
  current: Dashboard;
  previous: Headline & { from: string; to: string };
}

const DAY_MS = 86_400_000;
const toDate = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const fromDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A date (YYYY-MM-DD) moved by a number of days. */
export const addDays = (date: string, days: number) => fromDate(toDate(date) + days * DAY_MS);
/** 0 is Sunday. */
export const weekdayOf = (date: string) => new Date(toDate(date)).getUTCDay();
/** Days from `from` to `to`, both included. */
export const daysIn = (from: string, to: string) => Math.round((toDate(to) - toDate(from)) / DAY_MS) + 1;

export type PeriodKind = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month";
export const PERIODS: PeriodKind[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"];

/** A named period around the business day `today`. Weeks start on Sunday (Mahmoud, 2026-10-18). */
export function periodRange(kind: PeriodKind, today: string): { from: string; to: string } {
  const weekStart = addDays(today, -weekdayOf(today));
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (kind) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "this_week":
      return { from: weekStart, to: today };
    case "last_week":
      return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
    case "this_month":
      return { from: monthStart, to: today };
    case "last_month": {
      const end = addDays(monthStart, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
  }
}

/** The period of the same length just before. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysIn(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** A share in basis points (12.5% = 1250), rounded half up, in integers only. */
const share = (part: number, whole: number) => (whole > 0 ? Math.floor((2 * part * 10_000 + whole) / (2 * whole)) : 0);

const sold = (orders: DashboardOrder[]) => orders.filter((o) => o.totals.status !== "voided");

export function headline(orders: DashboardOrder[], events: DashboardEvent[]): Headline {
  const list = sold(orders);
  const salesCents = list.reduce((s, o) => s + o.totals.foodCents, 0);
  return {
    salesCents,
    orders: list.length,
    averageCents: list.length ? Math.floor(salesCents / list.length) : 0,
    discountCents: list.reduce((s, o) => s + o.totals.discountCents, 0),
    refundCents: events.filter((e) => e.kind === "refund").reduce((s, e) => s + e.amountCents, 0),
    voids: events.filter((e) => e.kind === "void").length,
  };
}

export function dashboard(input: DashboardInput): Dashboard {
  const list = sold(input.orders);
  const byKey = <T>(map: Map<string, T>, key: string, make: () => T) => {
    const row = map.get(key) ?? make();
    map.set(key, row);
    return row;
  };

  const methods = new Map<string, { walletName: string | null; count: number; amountCents: number }>();
  for (const e of input.events) {
    if (e.kind !== "payment") continue;
    const walletName = e.method === "wallet" ? (e.walletName ?? "") : null;
    const row = byKey(methods, walletName ?? "\u0000cash", () => ({ walletName, count: 0, amountCents: 0 }));
    row.count += 1;
    row.amountCents += e.amountCents;
  }

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, salesCents: 0 }));
  const days = Array.from({ length: Math.max(0, daysIn(input.from, input.to)) }, (_, i) => ({ date: addDays(input.from, i), orders: 0, salesCents: 0 }));
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const o of list) {
    const h = hours[o.hour];
    if (h) {
      h.orders += 1;
      h.salesCents += o.totals.foodCents;
    }
    const d = days[dayIndex.get(o.businessDate) ?? -1];
    if (d) {
      d.orders += 1;
      d.salesCents += o.totals.foodCents;
    }
  }

  const weekdays =
    days.length >= 7
      ? Array.from({ length: 7 }, (_, weekday) => {
          const openDays = input.openDates.filter((date) => weekdayOf(date) === weekday).length;
          const salesCents = days.filter((d) => weekdayOf(d.date) === weekday).reduce((s, d) => s + d.salesCents, 0);
          return { weekday, openDays, salesCents, averageCents: openDays ? Math.floor(salesCents / openDays) : 0 };
        })
      : [];

  const items = new Map<string, Dashboard["items"][number]>();
  const categories = new Map<string, Dashboard["categories"][number]>();
  const count = (nameAr: string, sizeAr: string | null, categoryAr: string, halves: number, cents: number) => {
    const item = byKey(items, `${nameAr}\u0000${sizeAr ?? ""}`, () => ({ nameAr, sizeAr, categoryAr, halves: 0, salesCents: 0, shareBp: 0 }));
    item.halves += halves;
    item.salesCents += cents;
    const category = byKey(categories, categoryAr, () => ({ nameAr: categoryAr, halves: 0, salesCents: 0, shareBp: 0 }));
    category.halves += halves;
    category.salesCents += cents;
  };
  for (const o of list) {
    for (const l of o.lines) {
      if (l.otherHalfAr) {
        // Split in whole pounds; the odd pound, if any, stays with the first half.
        const second = Math.floor(l.totalCents / 200) * 100;
        count(l.nameAr, l.sizeAr, l.categoryAr, l.qty, l.totalCents - second);
        count(l.otherHalfAr, l.sizeAr, l.categoryAr, l.qty, second);
      } else count(l.nameAr, l.sizeAr, l.categoryAr, 2 * l.qty, l.totalCents);
    }
  }
  const itemsTotalCents = [...items.values()].reduce((s, i) => s + i.salesCents, 0);
  for (const row of [...items.values(), ...categories.values()]) row.shareBp = share(row.salesCents, itemsTotalCents);

  const stock = new Map<string, Dashboard["stock"]["items"][number]>();
  for (const s of input.stock) {
    const row = byKey(stock, s.nameAr, () => ({ nameAr: s.nameAr, unit: s.unit, qty: 0, deliveries: 0, costCents: 0 }));
    row.qty += s.qty;
    row.deliveries += 1;
    row.costCents += s.costCents ?? 0;
  }
  const stockItems = [...stock.values()].sort((a, b) => b.costCents - a.costCents || a.nameAr.localeCompare(b.nameAr, "ar"));

  const bySales = <T extends { salesCents: number; nameAr: string }>(a: T, b: T) => b.salesCents - a.salesCents || a.nameAr.localeCompare(b.nameAr, "ar");
  return {
    from: input.from,
    to: input.to,
    headline: headline(input.orders, input.events),
    byType: ORDER_TYPES.map((type) => {
      const ofType = list.filter((o) => o.type === type);
      return { type, count: ofType.length, salesCents: ofType.reduce((s, o) => s + o.totals.foodCents, 0) };
    }),
    byMethod: [...methods.values()].sort((a, b) => (a.walletName === null ? -1 : b.walletName === null ? 1 : b.amountCents - a.amountCents)),
    hours,
    days,
    weekdays,
    items: [...items.values()].sort(bySales),
    categories: [...categories.values()].sort(bySales),
    itemsTotalCents,
    stock: { totalCents: stockItems.reduce((s, i) => s + i.costCents, 0), items: stockItems },
  };
}

/** Cents as a plain number of pounds for a spreadsheet: 125,050 → "1250.5". */
export function poundsCell(amount: number): string {
  const frac = Math.abs(amount % 100);
  return `${Math.trunc(amount / 100)}${frac ? `.${String(frac).padStart(2, "0").replace(/0$/, "")}` : ""}`;
}

/** Halves as a plain number: 5 → "2.5". */
export const halvesCell = (halves: number) => `${Math.trunc(halves / 2)}${halves % 2 ? ".5" : ""}`;

/** Basis points as a percentage: 1,250 → "12.5". */
export const shareCell = (bp: number) => poundsCell(bp);

/** One row per day, or per item, for a spreadsheet. Starts with a BOM so Excel reads the Arabic. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    // Typed text that starts like a formula is kept as text, so Excel never runs it.
    const s = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

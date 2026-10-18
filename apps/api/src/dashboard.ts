import { and, asc, between, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { businessDays, type Db, menuCategories, menuItems, orderEvents, orderLines, orders, stockItems, stockMoves } from "@pos/db";
import {
  type Dashboard,
  type DashboardEvent,
  type DashboardOrder,
  type DashboardView,
  daysIn,
  dashboard,
  halvesCell,
  headline,
  orderTotals,
  paymentOf,
  periodRange,
  poundsCell,
  previousRange,
  shareCell,
  toCsv,
} from "@pos/shared";
import { type DayStore, toMoneyEvent } from "./days.js";
import type { SettingsStore } from "./settings.js";

/** A year is plenty on a store PC, and keeps one request from reading everything. */
export const MAX_DAYS = 366;

/** The reports dashboard (docs/milestones/m10-reports-dashboard.md). Read-only: nothing here writes. */
export function createDashboardStore(db: Db, tenantId: string, timeZone: string, days: DayStore, settings: SettingsStore) {
  async function load(from: string, to: string) {
    const inPeriod = and(eq(orders.tenantId, tenantId), between(orders.businessDate, from, to));
    const list = await db
      .select({
        id: orders.id,
        type: orders.type,
        businessDate: orders.businessDate,
        totalCents: orders.totalCents,
        taxRateBp: orders.taxRateBp,
        hour: sql<number>`extract(hour from ${orders.sentAt} at time zone ${timeZone})::int`,
      })
      .from(orders)
      .where(inPeriod);
    const ids = db.select({ id: orders.id }).from(orders).where(inPeriod);
    const events = await db
      .select({ orderId: orderEvents.orderId, kind: orderEvents.kind, amountCents: orderEvents.amountCents })
      .from(orderEvents)
      .where(and(eq(orderEvents.tenantId, tenantId), inArray(orderEvents.orderId, ids)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    const lines = await db
      .select({
        orderId: orderLines.orderId,
        qty: orderLines.qty,
        nameAr: orderLines.nameAr,
        sizeKey: orderLines.sizeKey,
        sizeNameAr: orderLines.sizeNameAr,
        otherHalfAr: orderLines.otherHalfNameAr,
        totalCents: orderLines.totalCents,
        categoryAr: menuCategories.nameAr,
      })
      .from(orderLines)
      .leftJoin(menuItems, and(eq(menuItems.id, orderLines.itemId), eq(menuItems.tenantId, tenantId)))
      .leftJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
      .where(and(eq(orderLines.tenantId, tenantId), inArray(orderLines.orderId, ids)))
      .orderBy(asc(orderLines.lineNo));

    const byOrder = <T extends { orderId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const r of rows) map.set(r.orderId, [...(map.get(r.orderId) ?? []), r]);
      return map;
    };
    const eventsOf = byOrder(events);
    const linesOf = byOrder(lines);
    const dashboardOrders: DashboardOrder[] = list.map((o) => ({
      type: o.type,
      businessDate: o.businessDate,
      hour: o.hour,
      totals: orderTotals(
        o.totalCents,
        (eventsOf.get(o.id) ?? []).map(toMoneyEvent).filter((e) => e !== null),
        o.taxRateBp,
      ),
      lines: (linesOf.get(o.id) ?? []).map((l) => ({
        qty: l.qty,
        nameAr: l.nameAr,
        sizeAr: l.sizeKey === "one" ? null : l.sizeNameAr,
        otherHalfAr: l.otherHalfAr,
        categoryAr: l.categoryAr ?? "",
        totalCents: l.totalCents,
      })),
    }));

    // Payments, refunds and voids count on the day they happened, like the Z.
    const opened = await db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.tenantId, tenantId), between(businessDays.date, from, to)))
      .orderBy(asc(businessDays.date));
    const first = opened[0];
    const last = opened.at(-1);
    const money = opened.length
      ? await db
          .select({ kind: orderEvents.kind, amountCents: orderEvents.amountCents, data: orderEvents.data })
          .from(orderEvents)
          .where(
            and(
              eq(orderEvents.tenantId, tenantId),
              inArray(orderEvents.kind, ["payment", "refund", "void"]),
              or(
                inArray(
                  orderEvents.dayId,
                  opened.map((d) => d.id),
                ),
                // Events from before Milestone 5 have no day; their time decides.
                and(
                  isNull(orderEvents.dayId),
                  gte(orderEvents.createdAt, first!.openedAt),
                  last!.closedAt ? lt(orderEvents.createdAt, last!.closedAt) : undefined,
                ),
              ),
            ),
          )
      : [];
    const dashboardEvents: DashboardEvent[] = money.map((e) => ({
      kind: e.kind as DashboardEvent["kind"],
      amountCents: e.amountCents ?? 0,
      ...(e.kind === "void" ? {} : { method: paymentOf(e.data).method, walletName: paymentOf(e.data).walletName ?? null }),
    }));

    // Stock moves have no business day: the period runs from the cut-off hour on `from` to the cut-off hour after `to`.
    const { autoCloseHour } = await settings.get("day");
    const edge = (date: string) => sql`(${date}::date::timestamp + make_interval(hours => ${autoCloseHour})) at time zone ${timeZone}`;
    const stock = await db
      .select({ nameAr: stockItems.nameAr, unit: stockItems.unit, qty: stockMoves.qty, costCents: stockMoves.costCents })
      .from(stockMoves)
      .innerJoin(stockItems, eq(stockItems.id, stockMoves.stockItemId))
      .where(
        and(
          eq(stockMoves.tenantId, tenantId),
          eq(stockMoves.kind, "delivery"),
          sql`${stockMoves.createdAt} >= ${edge(from)}`,
          sql`${stockMoves.createdAt} < ${edge(to)} + interval '1 day'`,
        ),
      );

    return dashboard({ from, to, orders: dashboardOrders, events: dashboardEvents, openDates: opened.map((d) => d.date), stock });
  }

  return {
    async today() {
      return db.transaction(async (tx) => (await days.ensureOpen(tx)).date);
    },

    async view(from?: string, to?: string): Promise<DashboardView> {
      const today = await this.today();
      if (from === undefined || to === undefined) ({ from, to } = periodRange("this_week", today));
      const prev = previousRange(from, to);
      const [current, previous, day] = await Promise.all([load(from, to), load(prev.from, prev.to), settings.get("day")]);
      return { today, dayStartHour: day.autoCloseHour, current, previous: { ...prev, ...previous.headline } };
    },

    /** A spreadsheet of the period: one row per day, or one per item. */
    async csv(from: string, to: string, kind: "days" | "items") {
      const d = await load(from, to);
      if (kind === "days") {
        return toCsv([["التاريخ", "الطلبات", "المبيعات (ل.س)"], ...d.days.map((x) => [x.date, x.orders, poundsCell(x.salesCents)])]);
      }
      return toCsv([
        ["الصنف", "الحجم", "الفئة", "الكمية", "المبيعات (ل.س)", "النسبة %"],
        ...d.items.map((i) => [i.nameAr, i.sizeAr ?? "", i.categoryAr, halvesCell(i.halves), poundsCell(i.salesCents), shareCell(i.shareBp)]),
      ]);
    },
  };
}

export type DashboardStore = ReturnType<typeof createDashboardStore>;

export const validPeriod = (from: string, to: string) => from <= to && daysIn(from, to) <= MAX_DAYS;

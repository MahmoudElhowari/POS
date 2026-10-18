import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  auditLog,
  type BusinessDay,
  businessDays,
  type Db,
  type DayClose,
  dayCloses,
  type NoteCount,
  type Order,
  orderEvents,
  orderLines,
  orders,
  priceChanges,
  printJobs,
  staff,
} from "@pos/db";
import {
  countedCents,
  couponOf,
  type DayReport,
  type DayReportPaper,
  dayReport,
  driverOf,
  paymentOf,
  type MoneyEvent,
  type OrderTotals,
  orderTotals,
  type ReportEvent,
  type ReportOrder,
} from "@pos/shared";
import type { SettingsStore } from "./settings.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Why a day action was refused; the reports screen shows each one. */
export class DayRefused extends Error {
  constructor(
    readonly code: "unresolved" | "not_found" | "not_unpaid" | "is_delivery" | "bad_count" | "already_closed",
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

/** An order as today's list sees it: its totals, and whether it came over from an earlier day. */
export interface DayOrder {
  order: Order;
  totals: OrderTotals;
  carried: boolean;
  leftUnpaid: boolean;
  /** All of the order's events, oldest first. */
  events: EventRow[];
}

type EventRow = typeof orderEvents.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unpaid deliveries carry over; looking back a month is plenty for a pizza night. */
const CARRY_DAYS = 31;

export const toMoneyEvent = (e: { kind: string; amountCents: number | null }): MoneyEvent | null => {
  if (e.kind === "void") return { kind: "void" };
  if (e.kind === "discount" || e.kind === "delivery_fee" || e.kind === "payment" || e.kind === "refund") {
    return { kind: e.kind, amountCents: e.amountCents ?? 0 };
  }
  return null;
};

/**
 * Business days and the close of day (docs/milestones/m5-close-the-day.md).
 * A day runs from when it opens until a manager's Z, or until the automatic
 * close at the cut-off hour (4 AM) if nobody runs one.
 */
export function createDayStore(db: Db, tenantId: string, timeZone: string, settings: SettingsStore) {
  /** One day change at a time per restaurant; every money action takes this too. */
  const lock = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`days:${tenantId}`}))`);

  async function staffNames(tx: Tx | Db) {
    const rows = await tx.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.tenantId, tenantId));
    return new Map(rows.map((s) => [s.id, s.name]));
  }

  const inDay = (day: BusinessDay) => (e: EventRow) =>
    e.dayId === day.id ||
    // Events from before Milestone 5 have no day; their time decides.
    (e.dayId === null && e.createdAt >= day.openedAt && (day.closedAt === null || e.createdAt < day.closedAt));

  /** The day's own orders, plus deliveries from earlier days that are still unpaid or were paid today. */
  async function load(tx: Tx | Db, day: BusinessDay) {
    const own = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.businessDate, day.date)))
      .orderBy(desc(orders.number));
    const earlier = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.type, "delivery"),
          lt(orders.businessDate, day.date),
          gte(orders.businessDate, sql`${day.date}::date - ${CARRY_DAYS}::int`),
        ),
      )
      .orderBy(desc(orders.businessDate), desc(orders.number));
    const all = [...own, ...earlier];
    const ids = all.map((o) => o.id);
    const events = ids.length
      ? await tx
          .select()
          .from(orderEvents)
          .where(and(eq(orderEvents.tenantId, tenantId), inArray(orderEvents.orderId, ids)))
          .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id))
      : [];
    const byOrder = new Map<string, EventRow[]>();
    for (const e of events) byOrder.set(e.orderId, [...(byOrder.get(e.orderId) ?? []), e]);
    const today = inDay(day);

    const list: DayOrder[] = [];
    for (const order of all) {
      const evs = byOrder.get(order.id) ?? [];
      const totals = orderTotals(order.totalCents, evs.map(toMoneyEvent).filter((e) => e !== null), order.taxRateBp);
      const carried = order.businessDate !== day.date;
      const open = totals.status === "unpaid" || totals.status === "part_paid";
      if (carried && !open && !evs.some(today)) continue;
      list.push({ order, totals, carried, leftUnpaid: evs.some((e) => e.kind === "left_unpaid"), events: evs });
    }
    return { list, events: events.filter(today) };
  }

  async function report(tx: Tx | Db, day: BusinessDay): Promise<{ list: DayOrder[]; report: DayReport }> {
    const { list, events } = await load(tx, day);
    const names = await staffNames(tx);
    const name = (id: string | null) => (id ? (names.get(id) ?? "") : "");
    const ownIds = list.filter((d) => !d.carried).map((d) => d.order.id);
    const lines = ownIds.length
      ? await tx
          .select()
          .from(orderLines)
          .where(and(eq(orderLines.tenantId, tenantId), inArray(orderLines.orderId, ownIds)))
          .orderBy(asc(orderLines.lineNo))
      : [];
    const numbers = new Map(list.map((d) => [d.order.id, d.order.number]));

    const reportOrders: ReportOrder[] = list.map(({ order, totals, carried, events: evs }) => {
      const discount = evs.filter((e) => e.kind === "discount").at(-1);
      const left = evs.filter((e) => e.kind === "left_unpaid").at(-1);
      return {
        id: order.id,
        number: order.number,
        type: order.type,
        customerName: order.customerName,
        totals,
        sentToday: !carried,
        discountApprovedBy: discount?.approvedBy ? name(discount.approvedBy) : null,
        couponCode: couponOf(discount?.data)?.code ?? null,
        leftUnpaidBy: left ? name(left.staffId) : null,
        lines: lines
          .filter((l) => l.orderId === order.id)
          .map((l) => ({ qty: l.qty, nameAr: l.nameAr, sizeAr: l.sizeKey === "one" ? null : l.sizeNameAr, otherHalfAr: l.otherHalfNameAr })),
      };
    });
    const reportEvents: ReportEvent[] = events
      .filter((e): e is EventRow & { kind: ReportEvent["kind"] } => e.kind === "payment" || e.kind === "refund" || e.kind === "void" || e.kind === "delivered")
      .map((e) => ({
        orderId: e.orderId,
        number: numbers.get(e.orderId) ?? 0,
        kind: e.kind,
        amountCents: e.amountCents ?? 0,
        staffName: name(e.staffId),
        reason: e.reason,
        driverName: driverOf(e.data)?.driverName ?? null,
        ...(e.kind === "payment" || e.kind === "refund" ? { method: paymentOf(e.data).method, walletName: paymentOf(e.data).walletName ?? null } : {}),
      }));
    return { list, report: dayReport(reportOrders, reportEvents, day.floatCents) };
  }

  async function nextCloseNumber(tx: Tx) {
    const [row] = await tx
      .select({ n: sql<number>`coalesce(max(${dayCloses.number}), 0)::int + 1` })
      .from(dayCloses)
      .where(eq(dayCloses.tenantId, tenantId));
    return row!.n;
  }

  /** The open day, closing a day left open past the cut-off and opening the next one when needed. Call inside a transaction. */
  async function ensureOpen(tx: Tx): Promise<BusinessDay> {
    await lock(tx);
    const { autoCloseHour } = await settings.get("day");
    const storeDate = sql`((now() at time zone ${timeZone}) - make_interval(hours => ${autoCloseHour}))::date`;
    const [open] = await tx.select().from(businessDays).where(and(eq(businessDays.tenantId, tenantId), isNull(businessDays.closedAt)));
    if (open) {
      const { rows } = await tx.execute<{ stale: boolean }>(sql`select ${open.date}::date < ${storeDate} as stale`);
      if (!rows[0]?.stale) return open;
      // Nobody ran a Z: the day ends at the cut-off hour, without a count.
      const cutoff = sql`((${open.date}::date + 1)::timestamp + make_interval(hours => ${autoCloseHour})) at time zone ${timeZone}`;
      const [closed] = await tx.update(businessDays).set({ closedAt: cutoff }).where(eq(businessDays.id, open.id)).returning();
      const { report: frozen } = await report(tx, closed!);
      await tx.insert(dayCloses).values({
        tenantId,
        number: await nextCloseNumber(tx),
        dayId: closed!.id,
        kind: "automatic",
        floatCents: closed!.floatCents,
        expectedCents: frozen.expectedCashCents,
        report: frozen,
        closedAt: closed!.closedAt!,
      });
    }
    const [last] = await tx
      .select()
      .from(businessDays)
      .where(eq(businessDays.tenantId, tenantId))
      .orderBy(desc(businessDays.date))
      .limit(1);
    // After a Z before the cut-off, the next orders belong to the next day.
    const date = last ? sql`greatest(${storeDate}, ${last.date}::date + 1)` : storeDate;
    const openedAt = last?.closedAt ?? sql`(${storeDate}::timestamp + make_interval(hours => ${autoCloseHour})) at time zone ${timeZone}`;
    const [day] = await tx.insert(businessDays).values({ tenantId, date, openedAt }).returning();
    return day!;
  }

  function paper(kind: "x" | "z", day: BusinessDay, r: DayReport, extra: Partial<DayReportPaper> & { printedBy: string }): DayReportPaper {
    return {
      kind,
      number: null,
      date: day.date,
      openedAt: day.openedAt.toISOString(),
      printedAt: new Date().toISOString(),
      closeKind: null,
      reprint: false,
      count: null,
      report: r,
      ...extra,
    };
  }

  async function queue(tx: Tx | Db, kind: "x_report" | "z_report", payload: DayReportPaper) {
    await tx.insert(printJobs).values({ tenantId, printer: "receipt", kind, payload });
    await tx.execute(sql`select pg_notify('print_jobs', ${tenantId})`);
  }

  function closeView(c: DayClose, day: BusinessDay, names: Map<string, string>) {
    return {
      id: c.id,
      number: c.number,
      dayId: day.id,
      date: day.date,
      openedAt: day.openedAt.toISOString(),
      closedAt: c.closedAt.toISOString(),
      kind: c.kind,
      closedBy: c.closedBy ? (names.get(c.closedBy) ?? "") : null,
      floatCents: c.floatCents,
      expectedCents: c.expectedCents,
      countedCents: c.countedCents,
      differenceCents: c.differenceCents,
      notes: c.notes,
      otherCents: c.otherCents,
      report: c.report as DayReport,
    };
  }

  async function loadClose(id: string) {
    if (!UUID.test(id)) throw new DayRefused("not_found");
    const [row] = await db
      .select()
      .from(dayCloses)
      .innerJoin(businessDays, eq(businessDays.id, dayCloses.dayId))
      .where(and(eq(dayCloses.id, id), eq(dayCloses.tenantId, tenantId)));
    if (!row) throw new DayRefused("not_found");
    return closeView(row.day_closes, row.business_days, await staffNames(db));
  }

  return {
    ensureOpen,

    /** Today's list: the open day's orders and carried-over deliveries. */
    async today(): Promise<DayOrder[]> {
      return db.transaction(async (tx) => (await load(tx, await ensureOpen(tx))).list);
    },

    /** The X report: the open day so far, closing nothing. */
    async x() {
      return db.transaction(async (tx) => {
        const day = await ensureOpen(tx);
        const { report: r } = await report(tx, day);
        return { day: { id: day.id, date: day.date, openedAt: day.openedAt.toISOString(), floatCents: day.floatCents }, report: r, notesPounds: (await settings.get("day")).notesPounds };
      });
    },

    async printX(staffId: string) {
      await db.transaction(async (tx) => {
        const day = await ensureOpen(tx);
        const { report: r } = await report(tx, day);
        const names = await staffNames(tx);
        await queue(tx, "x_report", paper("x", day, r, { printedBy: names.get(staffId) ?? "" }));
      });
    },

    async setFloat(pounds: number, staffId: string) {
      await db.transaction(async (tx) => {
        const day = await ensureOpen(tx);
        await tx.update(businessDays).set({ floatCents: pounds * 100 }).where(eq(businessDays.id, day.id));
        await tx.insert(auditLog).values({ tenantId, staffId, action: "float_set", details: { date: day.date, fromCents: day.floatCents, toCents: pounds * 100 } });
      });
    },

    /** A manager closes the day leaving a dine-in or pickup order unpaid. */
    async leaveUnpaid(orderId: string, note: string, staffId: string) {
      if (!UUID.test(orderId)) throw new DayRefused("not_found");
      await db.transaction(async (tx) => {
        const day = await ensureOpen(tx);
        const { list } = await load(tx, day);
        const found = list.find((d) => d.order.id === orderId);
        if (!found) throw new DayRefused("not_found");
        if (found.order.type === "delivery") throw new DayRefused("is_delivery");
        if (!(found.totals.status === "unpaid" || found.totals.status === "part_paid") || found.leftUnpaid) throw new DayRefused("not_unpaid");
        await tx.insert(orderEvents).values({ tenantId, orderId, kind: "left_unpaid", staffId, note, dayId: day.id });
      });
    },

    /** The Z: count the drawer note by note, freeze the report, close the day and print it. */
    async close(input: { dayId: string; notes: NoteCount[]; otherPounds: number }, staffId: string) {
      const bad = (n: number) => !Number.isSafeInteger(n) || n < 0;
      if (input.notes.some((n) => bad(n.pounds) || n.pounds === 0 || bad(n.count)) || bad(input.otherPounds)) throw new DayRefused("bad_count");
      const notes = input.notes.filter((n) => n.count > 0);
      return db.transaction(async (tx) => {
        const day = await ensureOpen(tx);
        // The day on the manager's screen; a second tap, or another tablet, finds it closed.
        if (day.id !== input.dayId) throw new DayRefused("already_closed");
        const { report: r } = await report(tx, day);
        if (r.unresolved.length) throw new DayRefused("unresolved", r.unresolved);
        const counted = countedCents(notes, input.otherPounds);
        const difference = counted - r.expectedCashCents;
        const [closed] = await tx
          .update(businessDays)
          .set({ closedAt: sql`clock_timestamp()` })
          .where(eq(businessDays.id, day.id))
          .returning();
        const [row] = await tx
          .insert(dayCloses)
          .values({
            tenantId,
            number: await nextCloseNumber(tx),
            dayId: day.id,
            kind: "manual",
            floatCents: day.floatCents,
            expectedCents: r.expectedCashCents,
            countedCents: counted,
            differenceCents: difference,
            notes,
            otherCents: input.otherPounds * 100,
            report: r,
            closedBy: staffId,
            closedAt: closed!.closedAt!,
          })
          .returning();
        await tx.insert(auditLog).values({ tenantId, staffId, action: "day_closed", details: { date: day.date, z: row!.number, countedCents: counted, differenceCents: difference } });
        const names = await staffNames(tx);
        await queue(
          tx,
          "z_report",
          paper("z", closed!, r, {
            number: row!.number,
            closeKind: "manual",
            printedBy: names.get(staffId) ?? "",
            count: { notes, otherCents: input.otherPounds * 100, countedCents: counted, differenceCents: difference },
          }),
        );
        return closeView(row!, closed!, names);
      });
    },

    /** Every Z, newest first. */
    async closes() {
      const rows = await db
        .select()
        .from(dayCloses)
        .innerJoin(businessDays, eq(businessDays.id, dayCloses.dayId))
        .where(eq(dayCloses.tenantId, tenantId))
        .orderBy(desc(dayCloses.number));
      const names = await staffNames(db);
      return rows.map((r) => {
        const { report: _report, ...rest } = closeView(r.day_closes, r.business_days, names);
        return { ...rest, netCents: (r.day_closes.report as DayReport).netCents };
      });
    },

    getClose: loadClose,

    async reprintZ(id: string, staffId: string) {
      const c = await loadClose(id);
      const names = await staffNames(db);
      await queue(db, "z_report", {
        kind: "z",
        number: c.number,
        date: c.date,
        openedAt: c.openedAt,
        printedAt: new Date().toISOString(),
        printedBy: names.get(staffId) ?? "",
        closeKind: c.kind,
        reprint: true,
        report: c.report,
        count:
          c.countedCents === null
            ? null
            : { notes: c.notes, otherCents: c.otherCents, countedCents: c.countedCents, differenceCents: c.differenceCents ?? 0 },
      });
    },

    /** Everything that happened on one day: money events, staff, settings, prices and the float. */
    async audit(dayId?: string) {
      const day = dayId
        ? (await db.select().from(businessDays).where(and(eq(businessDays.id, dayId), eq(businessDays.tenantId, tenantId))))[0]
        : await db.transaction((tx) => ensureOpen(tx));
      if (!day) throw new DayRefused("not_found");
      const names = await staffNames(db);
      const name = (id: string | null) => (id ? (names.get(id) ?? "") : "");
      const end = day.closedAt ?? new Date(8.64e15);
      const window = (col: typeof auditLog.createdAt | typeof priceChanges.createdAt) => and(gte(col, day.openedAt), lt(col, end));

      const events = await db
        .select({ e: orderEvents, number: orders.number })
        .from(orderEvents)
        .innerJoin(orders, eq(orders.id, orderEvents.orderId))
        .where(
          and(
            eq(orderEvents.tenantId, tenantId),
            sql`(${orderEvents.dayId} = ${day.id} or (${orderEvents.dayId} is null and ${orderEvents.createdAt} >= ${day.openedAt} and ${orderEvents.createdAt} < ${end}))`,
          ),
        );
      const log = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), window(auditLog.createdAt)));
      const prices = await db.select().from(priceChanges).where(and(eq(priceChanges.tenantId, tenantId), window(priceChanges.createdAt)));

      const entries = [
        ...events.map(({ e, number }) => ({
          id: e.id,
          at: e.createdAt.toISOString(),
          kind: e.kind as string,
          staffName: name(e.staffId),
          approvedByName: e.approvedBy ? name(e.approvedBy) : null,
          orderNumber: number,
          amountCents: e.amountCents,
          reason: e.reason,
          note: e.note,
          details: {} as Record<string, unknown>,
        })),
        ...log.map((l) => ({
          id: l.id,
          at: l.createdAt.toISOString(),
          kind: l.action,
          staffName: name(l.staffId),
          approvedByName: null,
          orderNumber: null,
          amountCents: null,
          reason: null,
          note: "",
          details: l.details as Record<string, unknown>,
        })),
        ...prices.map((p) => ({
          id: p.id,
          at: p.createdAt.toISOString(),
          kind: `prices_${p.reason}`,
          staffName: name(p.staffId),
          approvedByName: null,
          orderNumber: null,
          amountCents: null,
          reason: null,
          note: "",
          details: p.percentBp === null ? {} : { percentBp: p.percentBp },
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return { day: { id: day.id, date: day.date }, entries };
    },
  };
}

export type DayStore = ReturnType<typeof createDayStore>;

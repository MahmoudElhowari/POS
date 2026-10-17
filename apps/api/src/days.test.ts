import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, createDb, printJobs, runMigrations } from "@pos/db";
import type { DayReportPaper, OrderDraft } from "@pos/shared";
import { createAuthStore } from "./auth/store.js";
import { createDayStore } from "./days.js";
import { createMenuStore } from "./menu/store.js";
import { menuSeed } from "./menu/types.js";
import { createMoneyStore } from "./orders/money.js";
import { createOrderStore } from "./orders/store.js";
import { createSettingsStore } from "./settings.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("close of day (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  async function store() {
    const tenantId = `t-${randomUUID()}`;
    const menu = createMenuStore(db, tenantId);
    await menu.importSeed(romantica);
    const auth = createAuthStore(db, tenantId);
    await auth.ensureInitialAdmin("1234");
    const { staff } = (await auth.login("1234"))!;
    const settings = createSettingsStore(db, tenantId);
    const days = createDayStore(db, tenantId, "Asia/Damascus", settings);
    const orders = createOrderStore(db, tenantId, menu, days, settings);
    const money = createMoneyStore(db, tenantId, days, settings);
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const staffId = staff.staffId;

    /** Corn Regular (750) + a can of soda (100) = 850. */
    const send = (type: OrderDraft["type"], name: string) =>
      orders.send(
        {
          type,
          ...(type === "dine_in" ? { tableNo: 1 } : {}),
          customer: { name },
          lines: [
            { itemId: item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 },
            { itemId: item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 1 },
          ],
        },
        staffId,
        85_000,
      );
    const dayId = async () => (await days.x()).day.id;
    const jobs = (kind: string) =>
      db
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.tenantId, tenantId), eq(printJobs.kind, kind)));
    return { tenantId, staffId, days, money, send, dayId, jobs };
  }

  it("adds up the day in the X report", async () => {
    const s = await store();
    const a = await s.send("pickup", "أ");
    await s.send("delivery", "ب");
    await s.money.payCash(a.id, 1000, s.staffId);
    await s.days.setFloat(500, s.staffId);

    const { report } = await s.days.x();
    expect(report).toMatchObject({ ordersCount: 2, netCents: 170_000, cashCents: 85_000, floatCents: 50_000, expectedCashCents: 135_000 });
    expect(report.items).toEqual([
      { nameAr: "بيتزا ذرة", sizeAr: "وسط", halves: 4 },
      { nameAr: "كولا", sizeAr: "علبة", halves: 4 },
    ]);
  });

  it("will not close while a dine-in or pickup order is unpaid, until a manager deals with it", async () => {
    const s = await store();
    const o = await s.send("dine_in", "طاولة");
    const day = await s.dayId();
    await expect(s.days.close({ dayId: day, notes: [], otherPounds: 0 }, s.staffId)).rejects.toMatchObject({
      code: "unresolved",
      detail: [{ id: o.id, number: 1, customerName: "طاولة", balanceCents: 85_000 }],
    });
    await s.days.leaveUnpaid(o.id, "سيدفع غداً", s.staffId);
    const z = await s.days.close({ dayId: day, notes: [], otherPounds: 0 }, s.staffId);
    expect(z.report.leftUnpaid).toEqual([{ number: 1, customerName: "طاولة", balanceCents: 85_000, staffName: "المدير" }]);
  });

  it("counts the drawer note by note, prints the Z, and starts the next day at order 1", async () => {
    const s = await store();
    const a = await s.send("pickup", "أ");
    await s.money.payCash(a.id, 1000, s.staffId);
    await s.days.setFloat(200, s.staffId);
    const day = await s.dayId();

    // Expected: 200 float + 850 cash = 1,050. Counted: 2 × 500 + 1 × 25 + 20 in coins = 1,045.
    const z = await s.days.close({ dayId: day, notes: [{ pounds: 500, count: 2 }, { pounds: 25, count: 1 }, { pounds: 10, count: 0 }], otherPounds: 20 }, s.staffId);
    expect(z).toMatchObject({ number: 1, kind: "manual", expectedCents: 105_000, countedCents: 104_500, differenceCents: -500, closedBy: "المدير" });
    expect(z.notes).toEqual([{ pounds: 500, count: 2 }, { pounds: 25, count: 1 }]);

    const [job] = await s.jobs("z_report");
    expect(job!.printer).toBe("receipt");
    expect(job!.payload as DayReportPaper).toMatchObject({ kind: "z", number: 1, count: { countedCents: 104_500, differenceCents: -500 } });

    const next = await s.send("pickup", "ج");
    expect(next.number).toBe(1);
    expect(next.businessDate > z.date).toBe(true);
    expect((await s.days.x()).report).toMatchObject({ ordersCount: 1, cashCents: 0, floatCents: 0 });
    // A second tap on the old day's Z finds it closed.
    await expect(s.days.close({ dayId: day, notes: [], otherPounds: 0 }, s.staffId)).rejects.toMatchObject({ code: "already_closed" });
  });

  it("carries an unpaid delivery to the next day, where its cash counts", async () => {
    const s = await store();
    const d = await s.send("delivery", "توصيل");
    const z = await s.days.close({ dayId: await s.dayId(), notes: [], otherPounds: 0 }, s.staffId);
    expect(z.report.carried).toEqual([{ number: 1, customerName: "توصيل", balanceCents: 85_000 }]);
    expect(z.report.netCents).toBe(85_000);

    const today = await s.money.today();
    expect(today.map((o) => [o.id, o.carried])).toEqual([[d.id, true]]);
    await s.money.payCash(d.id, 850, s.staffId);
    const { report } = await s.days.x();
    // The sale was yesterday's; the cash is today's.
    expect(report).toMatchObject({ ordersCount: 0, netCents: 0, cashCents: 85_000, carried: [] });
    expect((await s.money.today()).map((o) => o.totals.status)).toEqual(["paid"]);
  });

  it("closes a day left open past 4 AM by itself, without a count", async () => {
    const s = await store();
    await s.send("delivery", "أمس");
    // Pretend the day began yesterday.
    await db.execute(sql`update business_days set date = date - 1, opened_at = opened_at - interval '1 day' where tenant_id = ${s.tenantId}`);
    await db.execute(sql`update orders set business_date = business_date - 1 where tenant_id = ${s.tenantId}`);

    expect((await s.send("pickup", "اليوم")).number).toBe(1);
    const [auto] = await s.days.closes();
    expect(auto).toMatchObject({ number: 1, kind: "automatic", countedCents: null, closedBy: null, netCents: 85_000 });
    expect(new Date(auto!.closedAt).toISOString()).toMatch(/T01:00:00/); // 4 AM Damascus = 01:00 UTC
  });

  it("logs the float and the close", async () => {
    const s = await store();
    await s.days.setFloat(300, s.staffId);
    await s.days.close({ dayId: await s.dayId(), notes: [], otherPounds: 0 }, s.staffId);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.tenantId, s.tenantId))).map((a) => a.action).sort();
    expect(actions).toEqual(["day_closed", "float_set"]);
    const [z] = await s.days.closes();
    const { entries } = await s.days.audit(z!.dayId);
    // Loading the menu file at the start counts as a price change too.
    expect(entries.map((e) => e.kind).sort()).toEqual(["day_closed", "float_set", "prices_import"]);
  });

  it("never shows another restaurant's days", async () => {
    const a = await store();
    const b = await store();
    await a.send("pickup", "أ");
    await a.days.close({ dayId: await a.dayId(), notes: [], otherPounds: 0 }, a.staffId).catch(() => {});
    expect(await b.days.closes()).toEqual([]);
    expect((await b.days.x()).report.ordersCount).toBe(0);
  });
});

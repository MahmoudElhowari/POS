import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pos/db";
import { addDays, type OrderDraft } from "@pos/shared";
import { createAuditLog } from "./audit.js";
import { createAuthStore } from "./auth/store.js";
import { createDashboardStore } from "./dashboard.js";
import { createDayStore } from "./days.js";
import { createInventoryStore } from "./inventory.js";
import { createMenuStore } from "./menu/store.js";
import { menuSeed } from "./menu/types.js";
import { createMoneyStore } from "./orders/money.js";
import { createOrderStore } from "./orders/store.js";
import { createSettingsStore } from "./settings.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));
const TZ = "Asia/Damascus";

describe.skipIf(!url)("reports dashboard (Postgres)", () => {
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
    const days = createDayStore(db, tenantId, TZ, settings);
    const orders = createOrderStore(db, tenantId, menu, days, settings);
    const money = createMoneyStore(db, tenantId, days, settings);
    const inventory = createInventoryStore(db, tenantId, days, createAuditLog(db, tenantId));
    const dashboard = createDashboardStore(db, tenantId, TZ, days, settings);
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const staffId = staff.staffId;
    const send = (type: OrderDraft["type"], lines: OrderDraft["lines"], expected: number) =>
      orders.send({ type, ...(type === "dine_in" ? { tableNo: 1 } : {}), customer: { name: "ريم" }, lines }, staffId, expected);
    return { staffId, days, money, inventory, dashboard, item, send };
  }

  it("matches the X report for today, and splits the sales by hour, item and payment", async () => {
    const s = await store();
    // Corn Regular 750 + a can of soda 100, pickup, paid cash.
    const a = await s.send(
      "pickup",
      [
        { itemId: s.item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 },
        { itemId: s.item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 1 },
      ],
      85_000,
    );
    await s.money.pay(a.id, { method: "cash", tenderedPounds: 1_000 }, s.staffId);
    // ½ Corn ½ Sultan Large = 2,200, dine-in, paid by wallet.
    const b = await s.send(
      "dine_in",
      [{ itemId: s.item("Corn Pizza"), sizeKey: "large", otherHalfId: s.item("Sultan Pizza"), addons: [], removals: [], qty: 1 }],
      220_000,
    );
    await s.money.pay(b.id, { method: "wallet", wallet: "syriatel", amountPounds: 2_200, reference: "TX-1" }, s.staffId);
    // Voided: never counted as a sale.
    const c = await s.send("pickup", [{ itemId: s.item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 }], 75_000);
    await s.money.void(c.id, "customer_cancelled", "", s.staffId);
    // A delivery of flour with a price.
    const flour = await s.inventory.addItem({ nameAr: "طحين", unit: "g" }, s.staffId);
    await s.inventory.delivery(flour, 25_000, 400, "", s.staffId);

    const today = await s.dashboard.today();
    const { report } = await s.days.x();
    const view = await s.dashboard.view(today, today);
    const d = view.current;
    expect(view.today).toBe(today);
    expect(d.headline).toEqual({ salesCents: report.netCents, orders: report.ordersCount, averageCents: 152_500, discountCents: 0, refundCents: 0, voids: 1 });
    expect(d.headline.salesCents).toBe(305_000);
    expect(d.byMethod).toEqual([
      { walletName: null, count: 1, amountCents: report.cashCents },
      { walletName: "سيريتل كاش", count: 1, amountCents: 220_000 },
    ]);

    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    // The orders were sent seconds ago, so they're in this hour (or the one before, right on the hour).
    expect(d.hours[hour]!.orders + (d.hours[(hour + 23) % 24]!.orders ?? 0)).toBe(2);

    const items = Object.fromEntries(d.items.map((i) => [`${i.nameAr} ${i.sizeAr ?? ""}`.trim(), [i.halves, i.salesCents]]));
    expect(items).toMatchObject({ "بيتزا ذرة وسط": [2, 75_000], "بيتزا ذرة كبير": [1, 110_000], "بيتزا السلطان كبير": [1, 110_000] });
    expect(d.itemsTotalCents).toBe(305_000);
    expect(d.categories.map((c) => c.nameAr)).toContain("المشروبات");
    expect(d.stock).toEqual({ totalCents: 40_000, items: [{ nameAr: "طحين", unit: "g", qty: 25_000, deliveries: 1, costCents: 40_000 }] });

    expect(view.previous).toMatchObject({ from: addDays(today, -1), to: addDays(today, -1), salesCents: 0, orders: 0 });

    const csv = await s.dashboard.csv(today, today, "items");
    expect(csv.startsWith("﻿الصنف,")).toBe(true);
    expect(csv).toContain("بيتزا السلطان,كبير,");
    expect(await s.dashboard.csv(today, today, "days")).toContain(`${today},2,3050\r\n`);
  });

  it("counts a week day by day, and never shows another restaurant's sales", async () => {
    const a = await store();
    const b = await store();
    await a.send("pickup", [{ itemId: a.item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 }], 75_000);
    const today = await a.dashboard.today();
    const week = (await a.dashboard.view(addDays(today, -6), today)).current;
    expect(week.days).toHaveLength(7);
    expect(week.days.at(-1)).toMatchObject({ date: today, orders: 1, salesCents: 75_000 });
    expect(week.weekdays).toHaveLength(7);
    expect(week.weekdays.reduce((s, w) => s + w.openDays, 0)).toBe(1);

    await b.dashboard.today();
    const theirs = (await b.dashboard.view(addDays(today, -6), today)).current;
    expect(theirs.headline.orders).toBe(0);
    expect(theirs.items).toEqual([]);
  });
});

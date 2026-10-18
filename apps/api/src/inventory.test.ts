import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pos/db";
import type { OrderDraft } from "@pos/shared";
import { createAuditLog } from "./audit.js";
import { createAuthStore } from "./auth/store.js";
import { createDayStore } from "./days.js";
import { createInventoryStore } from "./inventory.js";
import { createMenuStore } from "./menu/store.js";
import { menuSeed } from "./menu/types.js";
import { createMoneyStore } from "./orders/money.js";
import { createOrderStore } from "./orders/store.js";
import { createSettingsStore } from "./settings.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("inventory (Postgres)", () => {
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
    const inventory = createInventoryStore(db, tenantId, days, createAuditLog(db, tenantId));
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const staffId = staff.staffId;
    /** Corn Regular (750) and Sultan Large (2,200) and three cans of soda (300) = 3,250. */
    const send = (type: OrderDraft["type"]) =>
      orders.send(
        {
          type,
          ...(type === "dine_in" ? { tableNo: 1 } : {}),
          customer: { name: "ريم" },
          lines: [
            { itemId: item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 },
            { itemId: item("Sultan Pizza"), sizeKey: "large", addons: [], removals: [], qty: 1 },
            { itemId: item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 3 },
          ],
        },
        staffId,
        325_000,
      );
    const row = async (nameAr: string) => (await inventory.report()).find((r) => r.nameAr === nameAr)!;
    return { tenantId, staffId, inventory, money, send, row, item };
  }

  it("starts with the drinks and the pizza boxes, once", async () => {
    const s = await store();
    await s.inventory.ensureStarter();
    await s.inventory.ensureStarter();
    const names = (await s.inventory.report()).map((r) => r.nameAr);
    expect(names).toEqual(expect.arrayContaining(["علبة بيتزا وسط", "علبة بيتزا كبير"]));
    expect(names.filter((n) => n.startsWith("كولا"))).toHaveLength(2);
    expect(names).toHaveLength(6);
    expect((await s.row("علبة بيتزا كبير")).links).toMatchObject([{ categoryKind: "pizza", sizeKey: "large", takeawayOnly: true }]);
  });

  it("takes cans and boxes off with a sale, no boxes for dine-in, and gives them back when an order is voided", async () => {
    const s = await store();
    await s.inventory.ensureStarter();
    const cans = await s.row("كولا · علبة");
    await s.inventory.delivery(cans.id, 48, 4_800, "موزع المشروبات", s.staffId);

    const takeaway = await s.send("pickup");
    await s.send("dine_in");
    expect(await s.row("كولا · علبة")).toMatchObject({ level: 42, today: { in: 48, used: 6, wasted: 0 } });
    expect((await s.row("علبة بيتزا وسط")).level).toBe(-1);
    expect((await s.row("علبة بيتزا كبير")).level).toBe(-1);

    await s.money.void(takeaway.id, "customer_cancelled", "", s.staffId);
    expect(await s.row("كولا · علبة")).toMatchObject({ level: 45, today: { used: 3 } });
    expect((await s.row("علبة بيتزا كبير")).level).toBe(0);
  });

  it("records waste and counts, and a count sets the level to what is on the shelf", async () => {
    const s = await store();
    const flour = await s.inventory.addItem({ nameAr: "طحين", unit: "g" }, s.staffId);
    await s.inventory.delivery(flour, 25_000, null, "", s.staffId);
    expect(await s.inventory.waste(flour, 1_500, "رطوبة", s.staffId)).toEqual({ level: 23_500 });
    expect(await s.inventory.count(flour, 22_000, s.staffId)).toEqual({ level: 22_000 });
    expect(await s.row("طحين")).toMatchObject({
      level: 22_000,
      today: { in: 25_000, used: 0, wasted: 1_500 },
      lastCount: { counted: 22_000, difference: -1_500 },
    });
    const moves = await s.inventory.moves(flour);
    expect(moves.map((m) => [m.kind, m.qty])).toEqual([
      ["count", -1_500],
      ["waste", -1_500],
      ["delivery", 25_000],
    ]);
    await expect(s.inventory.waste(flour, 0, "", s.staffId)).rejects.toMatchObject({ code: "bad_qty" });
    await s.inventory.updateItem(flour, { active: false }, s.staffId);
    await expect(s.inventory.delivery(flour, 1, null, "", s.staffId)).rejects.toMatchObject({ code: "inactive" });
  });

  it("links a stock item to one menu item and size", async () => {
    const s = await store();
    const cheese = await s.inventory.addItem({ nameAr: "علبة جبنة إضافية", unit: "piece" }, s.staffId);
    await expect(s.inventory.addLink({ stockItemId: cheese, qty: 1 }, s.staffId)).rejects.toMatchObject({ code: "bad_link" });
    await s.inventory.addLink({ stockItemId: cheese, itemId: s.item("Sultan Pizza"), sizeKey: "large", qty: 2 }, s.staffId);
    await s.send("dine_in");
    expect((await s.row("علبة جبنة إضافية")).level).toBe(-2);
    const [link] = (await s.row("علبة جبنة إضافية")).links;
    expect(await s.inventory.removeLink(link!.id, s.staffId)).toBe(true);
    await s.send("dine_in");
    expect((await s.row("علبة جبنة إضافية")).level).toBe(-2);
  });

  it("never shows or changes another restaurant's stock", async () => {
    const a = await store();
    const b = await store();
    const flour = await a.inventory.addItem({ nameAr: "طحين", unit: "g" }, a.staffId);
    expect(await b.inventory.report()).toEqual([]);
    await expect(b.inventory.delivery(flour, 1_000, null, "", b.staffId)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.inventory.addLink({ stockItemId: flour, categoryKind: "pizza", qty: 1 }, b.staffId)).rejects.toMatchObject({ code: "not_found" });
    const theirs = await b.inventory.addItem({ nameAr: "علبة", unit: "piece" }, b.staffId);
    await expect(b.inventory.addLink({ stockItemId: theirs, itemId: a.item("Soda"), qty: 1 }, b.staffId)).rejects.toMatchObject({ code: "bad_link" });
    await expect(a.inventory.addItem({ nameAr: "طحين", unit: "g" }, a.staffId)).rejects.toMatchObject({ code: "duplicate" });
  });
});

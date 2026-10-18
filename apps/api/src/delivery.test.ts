import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, printJobs, runMigrations } from "@pos/db";
import type { OrderDraft } from "@pos/shared";
import { createAuditLog } from "./audit.js";
import { createAuthStore } from "./auth/store.js";
import { createDayStore } from "./days.js";
import { createDeliveryStore } from "./delivery.js";
import { createMenuStore } from "./menu/store.js";
import { menuSeed } from "./menu/types.js";
import { createMoneyStore } from "./orders/money.js";
import { createOrderStore } from "./orders/store.js";
import { createSettingsStore } from "./settings.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("delivery board (Postgres)", () => {
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
    const delivery = createDeliveryStore(db, tenantId, days, money, createAuditLog(db, tenantId));
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const staffId = staff.staffId;

    /** Corn Regular (750) + a can of soda (100) = 850. */
    const send = (type: OrderDraft["type"], name: string) =>
      orders.send(
        {
          type,
          ...(type === "dine_in" ? { tableNo: 1 } : {}),
          customer: { name, phone: "0933000000", area: "المزة", directions: "بناء 4" },
          lines: [
            { itemId: item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 },
            { itemId: item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 1 },
          ],
        },
        staffId,
        85_000,
      );
    const receipts = () =>
      db
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.tenantId, tenantId), eq(printJobs.kind, "receipt")));
    return { tenantId, staffId, days, money, delivery, send, receipts };
  }

  it("takes an order out and back in delivered, with the cash, and the driver keeps the fee", async () => {
    const s = await store();
    const o = await s.send("delivery", "خالد");
    await s.money.deliveryFee(o.id, 300, s.staffId);
    const abuAli = await s.delivery.addDriver("أبو علي", s.staffId);

    let board = await s.delivery.board();
    expect(board.drivers).toEqual([{ id: abuAli, name: "أبو علي" }]);
    expect(board.orders).toMatchObject([{ id: o.id, number: 1, phone: "0933000000", area: "المزة", delivery: { state: "waiting" } }]);

    await s.delivery.out([o.id], abuAli, s.staffId);
    board = await s.delivery.board();
    expect(board.orders[0]!.delivery).toMatchObject({ state: "out", driverName: "أبو علي" });

    // 850 + 300 fee = 1,150; the driver hands over 1,200.
    const paid = await s.delivery.delivered(o.id, 1200, s.staffId);
    expect(paid).toMatchObject({ totals: { status: "paid", totalCents: 115_000, taxIncludedCents: 4_000 }, changeCents: 5_000 });
    expect(await s.receipts()).toHaveLength(1);

    board = await s.delivery.board();
    expect(board.orders[0]!.delivery.state).toBe("delivered");
    expect(board.summary).toEqual([{ name: "أبو علي", orders: 1, collectedCents: 115_000, feesCents: 30_000, handInCents: 85_000 }]);
    const { report } = await s.days.x();
    // The fee is the driver's: not a sale, and not in the drawer.
    expect(report).toMatchObject({ netCents: 85_000, deliveryFeeCents: 30_000, driverFeesCents: 30_000, cashCents: 115_000, expectedCashCents: 85_000 });
  });

  it("only sends out waiting delivery orders, and takes one back when the driver returns it", async () => {
    const s = await store();
    const pickup = await s.send("pickup", "سامر");
    const o = await s.send("delivery", "ريم");
    const a = await s.delivery.addDriver("أبو علي", s.staffId);
    const b = await s.delivery.addDriver("حسام", s.staffId);

    await expect(s.delivery.out([pickup.id], a, s.staffId)).rejects.toMatchObject({ code: "not_delivery" });
    await expect(s.delivery.delivered(o.id, null, s.staffId)).rejects.toMatchObject({ code: "not_out" });
    await s.delivery.out([o.id], a, s.staffId);
    await expect(s.delivery.out([o.id], b, s.staffId)).rejects.toMatchObject({ code: "not_waiting" });

    await s.delivery.returned(o.id, "لم يرد على الهاتف", s.staffId);
    expect((await s.delivery.board()).orders[0]!.delivery.state).toBe("waiting");
    await s.delivery.out([o.id], b, s.staffId);
    // Delivered without cash: the customer still owes it, and it carries over at the Z.
    const { totals } = await s.delivery.delivered(o.id, null, s.staffId);
    expect(totals.status).toBe("unpaid");
    expect((await s.delivery.board()).summary).toEqual([{ name: "حسام", orders: 1, collectedCents: 0, feesCents: 0, handInCents: 0 }]);
  });

  it("refuses a driver who has stopped working, or a name already on the list", async () => {
    const s = await store();
    const o = await s.send("delivery", "ريم");
    const a = await s.delivery.addDriver("أبو علي", s.staffId);
    await expect(s.delivery.addDriver("أبو علي", s.staffId)).rejects.toMatchObject({ code: "duplicate" });
    const b = await s.delivery.addDriver("حسام", s.staffId);
    await expect(s.delivery.updateDriver(b, { name: "أبو علي" }, s.staffId)).rejects.toMatchObject({ code: "duplicate" });
    await s.delivery.updateDriver(a, { active: false }, s.staffId);
    await expect(s.delivery.out([o.id], a, s.staffId)).rejects.toMatchObject({ code: "no_driver" });
    expect((await s.delivery.board()).drivers.map((d) => d.name)).toEqual(["حسام"]);
  });

  it("never shows or uses another restaurant's drivers or orders", async () => {
    const a = await store();
    const b = await store();
    const o = await a.send("delivery", "ريم");
    const driverA = await a.delivery.addDriver("أبو علي", a.staffId);
    expect(await b.delivery.board()).toEqual({ orders: [], drivers: [], summary: [] });
    await expect(b.delivery.out([o.id], driverA, b.staffId)).rejects.toMatchObject({ code: "no_driver" });
    const driverB = await b.delivery.addDriver("أبو علي", b.staffId);
    await expect(b.delivery.out([o.id], driverB, b.staffId)).rejects.toMatchObject({ code: "not_found" });
  });
});

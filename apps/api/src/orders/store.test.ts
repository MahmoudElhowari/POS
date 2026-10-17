import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, orders, runMigrations } from "@pos/db";
import type { OrderDraft } from "@pos/shared";
import { createStaffStore, StaffRefused } from "../auth/staff.js";
import { createAuthStore } from "../auth/store.js";
import { createMenuStore } from "../menu/store.js";
import { createSettingsStore } from "../settings.js";
import { menuSeed } from "../menu/types.js";
import { createOrderStore, OrderRefused } from "./store.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("order store (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  async function freshStore() {
    const tenantId = `t-${randomUUID()}`;
    const menu = createMenuStore(db, tenantId);
    await menu.importSeed(romantica);
    const auth = createAuthStore(db, tenantId);
    await auth.ensureInitialAdmin("1234");
    const { staff } = (await auth.login("1234"))!;
    const store = createOrderStore(db, tenantId, menu, "Asia/Damascus", createSettingsStore(db, tenantId));
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!;
    return { tenantId, menu, store, staffId: staff.staffId, item };
  }

  type Fresh = Awaited<ReturnType<typeof freshStore>>;

  // ½ Sultan + ½ Corn Large with a removal, plus a cheese crust on a plain Corn Regular.
  function pizzaOrder({ item }: Fresh, extra: Partial<OrderDraft> = {}): OrderDraft {
    const sultan = item("Sultan Pizza");
    const corn = item("Corn Pizza");
    return {
      type: "delivery",
      customer: { name: "أبو أحمد", phone: "0944 123 456", area: "المزة", directions: "قرب الجامع" },
      lines: [
        { itemId: sultan.id, sizeKey: "large", otherHalfId: corn.id, addons: [], removals: [corn.removable[0]!.ar], qty: 1 },
        { itemId: corn.id, sizeKey: "regular", addons: ["cheese"], removals: [], note: "مقرمشة", qty: 2 },
      ],
      ...extra,
    };
  }
  // Sultan Large 2200 + 2 × (Corn Regular 750 + cheese 200) = 4100 pounds.
  const PIZZA_TOTAL = 410_000;

  it("sends an order with frozen names and prices and a sent event", async () => {
    const fresh = await freshStore();
    const sent = await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL);
    expect(sent).toMatchObject({ number: 1, totalCents: PIZZA_TOTAL });

    const order = (await fresh.store.get(sent.id))!;
    expect(order).toMatchObject({ type: "delivery", customerName: "أبو أحمد", customerPhone: "0944123456", deliveryArea: "المزة" });
    expect(order.lines.map((l) => [l.nameEn, l.otherHalfNameEn, l.sizeNameAr, l.qty, l.unitCents, l.totalCents])).toEqual([
      ["Sultan Pizza", "Corn Pizza", "كبير", 1, 220_000, 220_000],
      ["Corn Pizza", null, "وسط", 2, 95_000, 190_000],
    ]);
    expect(order.lines[0]!.removals).toEqual([{ ar: "صوص", en: "Pizza Sauce" }]);
    expect(order.lines[1]!.addons).toEqual([{ key: "cheese", nameAr: "محشية الأطراف", nameEn: "Stuffed Crust (cheese)", cents: 20_000 }]);
  });

  it("numbers orders 1, 2, 3 and starts again the next day", async () => {
    const fresh = await freshStore();
    const a = await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL);
    const b = await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL);
    expect([a.number, b.number]).toEqual([1, 2]);

    // Pretend both were sent yesterday: today's numbering starts at 1 again.
    await db.execute(sql`update orders set business_date = business_date - 1 where tenant_id = ${fresh.tenantId}`);
    expect((await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL)).number).toBe(1);
  });

  it("keeps the price of a sent order when the menu price changes", async () => {
    const fresh = await freshStore();
    const sent = await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL);
    const sultanLarge = fresh.item("Sultan Pizza").sizes.find((s) => s.sizeKey === "large")!;
    await fresh.menu.updateSize(sultanLarge.id, { pricePounds: 2500 }, fresh.staffId);

    expect((await fresh.store.get(sent.id))!.totalCents).toBe(PIZZA_TOTAL);
    // A new send at the old total is refused with the new one.
    await expect(fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL)).rejects.toMatchObject({
      code: "price_changed",
      detail: { totalCents: PIZZA_TOTAL + 30_000 },
    });
  });

  it("refuses a crust stuffing on a pizza whose crust is built in, even when that stuffing is not sold alone", async () => {
    const fresh = await freshStore();
    // Sultan comes with a sujuq crust; sujuq has no price of its own yet.
    const draft = pizzaOrder(fresh);
    draft.lines = [{ ...draft.lines[0]!, addons: ["cheese"] }];
    const err = await fresh.store.send(draft, fresh.staffId, PIZZA_TOTAL + 40_000).catch((e: unknown) => e);
    expect((err as OrderRefused).detail.problems).toEqual([{ code: "pricing", line: 0, detail: expect.stringContaining("crust_built_in") }]);
  });

  it("refuses an item that went out of stock", async () => {
    const fresh = await freshStore();
    await fresh.menu.updateItem(fresh.item("Corn Pizza").id, { available: false });
    const err = await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrderRefused);
    expect((err as OrderRefused).detail.problems).toEqual([
      { code: "item_unavailable", line: 0 },
      { code: "item_unavailable", line: 1 },
    ]);
  });

  it("needs a name and, for dine-in, a table", async () => {
    const fresh = await freshStore();
    await expect(fresh.store.send(pizzaOrder(fresh, { customer: { name: "" } }), fresh.staffId, PIZZA_TOTAL)).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(fresh.store.send(pizzaOrder(fresh, { type: "dine_in" }), fresh.staffId, PIZZA_TOTAL)).rejects.toMatchObject({ code: "invalid" });
    const dineIn = await fresh.store.send(pizzaOrder(fresh, { type: "dine_in", tableNo: 4 }), fresh.staffId, PIZZA_TOTAL);
    const order = (await fresh.store.get(dineIn.id))!;
    expect(order.tableNo).toBe(4);
    expect(order.deliveryArea).toBe(""); // address only kept for delivery
  });

  it("holds, updates, recalls and sends an order once", async () => {
    const fresh = await freshStore();
    const heldId = await fresh.store.hold(pizzaOrder(fresh, { type: "pickup" }), fresh.staffId);
    await fresh.store.hold(pizzaOrder(fresh, { type: "pickup", note: "بعد ربع ساعة" }), fresh.staffId, heldId);
    const [held] = await fresh.store.held();
    expect(held).toMatchObject({ id: heldId, draft: { note: "بعد ربع ساعة" } });

    await fresh.store.send(held!.draft, fresh.staffId, PIZZA_TOTAL, heldId);
    expect(await fresh.store.held()).toEqual([]);
    await expect(fresh.store.send(held!.draft, fresh.staffId, PIZZA_TOTAL, heldId)).rejects.toMatchObject({ code: "not_held" });
  });

  it("remembers customers by phone and finds them by the first digits", async () => {
    const fresh = await freshStore();
    await fresh.store.send(pizzaOrder(fresh), fresh.staffId, PIZZA_TOTAL);
    // Same phone, new name: the customer is updated, not duplicated.
    await fresh.store.send(pizzaOrder(fresh, { customer: { name: "أحمد", phone: "0944123456" } }), fresh.staffId, PIZZA_TOTAL);
    expect(await fresh.store.findCustomers("0944")).toEqual([
      expect.objectContaining({ name: "أحمد", phone: "0944123456", area: "المزة", directions: "قرب الجامع" }),
    ]);
    expect(await fresh.store.findCustomers("09")).toEqual([]); // too short to search
  });

  it("never shows another restaurant's orders or customers", async () => {
    const a = await freshStore();
    const b = await freshStore();
    const sent = await a.store.send(pizzaOrder(a), a.staffId, PIZZA_TOTAL);
    await a.store.hold(pizzaOrder(a), a.staffId);
    expect(await b.store.get(sent.id)).toBeNull();
    expect(await b.store.held()).toEqual([]);
    expect(await b.store.findCustomers("0944")).toEqual([]);
    const rows = await db.select().from(orders).where(and(eq(orders.tenantId, b.tenantId)));
    expect(rows).toEqual([]);
  });
});

describe.skipIf(!url)("staff store (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  async function fresh() {
    const tenantId = `t-${randomUUID()}`;
    const auth = createAuthStore(db, tenantId);
    await auth.ensureInitialAdmin("1234");
    return { auth, staff: createStaffStore(db, tenantId) };
  }

  it("adds a cashier who can sign in with their own PIN", async () => {
    const { auth, staff } = await fresh();
    await staff.create({ name: "سامر", role: "cashier", pin: "5678" });
    expect((await auth.login("5678"))?.staff).toMatchObject({ name: "سامر", role: "cashier" });
    expect((await staff.list()).map((s) => s.role)).toEqual(["admin", "cashier"]);
  });

  it("refuses a PIN another person already uses", async () => {
    const { staff } = await fresh();
    await expect(staff.create({ name: "سامر", role: "cashier", pin: "1234" })).rejects.toBeInstanceOf(StaffRefused);
  });

  it("signs a deactivated person out and keeps the last admin", async () => {
    const { auth, staff } = await fresh();
    const id = await staff.create({ name: "سامر", role: "cashier", pin: "5678" });
    const { token } = (await auth.login("5678"))!;
    await staff.update(id, { active: false });
    expect(await auth.session(token)).toBeNull();
    expect(await auth.login("5678")).toBeNull();

    const [admin] = await staff.list();
    await expect(staff.update(admin!.id, { active: false })).rejects.toMatchObject({ code: "last_admin" });
    await expect(staff.update(admin!.id, { role: "cashier" })).rejects.toMatchObject({ code: "last_admin" });
  });
});

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, printJobs, runMigrations } from "@pos/db";
import type { CustomerReceipt, KitchenTicket, OrderDraft } from "@pos/shared";
import { createAuthStore } from "../auth/store.js";
import { createMenuStore } from "../menu/store.js";
import { menuSeed } from "../menu/types.js";
import { createDayStore } from "../days.js";
import { createSettingsStore } from "../settings.js";
import { createMoneyStore, MoneyRefused } from "./money.js";
import { createOrderStore } from "./store.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("money store (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  // Sultan Large (2,200) + Corn Regular with a cheese crust (950) + a can of soda (100) = 3,250.
  async function sentOrder(type: OrderDraft["type"] = "delivery") {
    const tenantId = `t-${randomUUID()}`;
    const menu = createMenuStore(db, tenantId);
    await menu.importSeed(romantica);
    const auth = createAuthStore(db, tenantId);
    await auth.ensureInitialAdmin("1234");
    const { staff } = (await auth.login("1234"))!;
    const settings = createSettingsStore(db, tenantId);
    const days = createDayStore(db, tenantId, "Asia/Damascus", settings);
    const store = createOrderStore(db, tenantId, menu, days, settings);
    const money = createMoneyStore(db, tenantId, days, settings);
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const draft: OrderDraft = {
      type,
      ...(type === "dine_in" ? { tableNo: 2 } : {}),
      customer: { name: "أبو أحمد", area: "المزة" },
      lines: [
        { itemId: item("Sultan Pizza"), sizeKey: "large", addons: [], removals: [], qty: 1 },
        { itemId: item("Corn Pizza"), sizeKey: "regular", addons: ["cheese"], removals: ["صوص"], note: "مقرمشة", qty: 1 },
        { itemId: item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 1 },
      ],
    };
    const sent = await store.send(draft, staff.staffId, 325_000);
    const jobs = (printer: string) =>
      db
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.tenantId, tenantId), eq(printJobs.printer, printer)));
    return { tenantId, staffId: staff.staffId, auth, settings, money, orderId: sent.id, number: sent.number, jobs };
  }

  it("queues a kitchen ticket when an order is sent", async () => {
    const o = await sentOrder();
    const [job] = await o.jobs("kitchen");
    const ticket = job!.payload as KitchenTicket;
    expect(ticket).toMatchObject({ number: 1, type: "delivery", area: "المزة", reprint: false });
    expect(ticket.lines[1]).toEqual({
      qty: 1,
      nameAr: "بيتزا ذرة",
      sizeAr: "وسط",
      otherHalfAr: null,
      addonsAr: ["محشية الأطراف"],
      removalsAr: ["صوص"],
      note: "مقرمشة",
    });
    expect(await o.jobs("receipt")).toEqual([]); // the receipt waits for payment
  });

  it("shows today's orders with 5% tax included and nothing paid", async () => {
    const o = await sentOrder();
    const [row] = await o.money.today();
    expect(row).toMatchObject({ number: 1, customerName: "أبو أحمد" });
    expect(row!.totals).toMatchObject({ totalCents: 325_000, taxIncludedCents: 15_500, balanceCents: 325_000, status: "unpaid" });
  });

  it("adds a delivery fee and a discount, takes cash, gives change and prints the receipt", async () => {
    const o = await sentOrder();
    await o.money.deliveryFee(o.orderId, 300, o.staffId);
    const afterDiscount = await o.money.discount(o.orderId, { percentBp: 1000 }, o.staffId, o.staffId);
    // 3,250 − 10% (325) + 300 = 3,225
    expect(afterDiscount.totalCents).toBe(322_500);

    const { totals, changeCents } = await o.money.pay(o.orderId, { method: "cash", tenderedPounds: 5000 }, o.staffId);
    expect(totals.status).toBe("paid");
    expect(changeCents).toBe(177_500);

    const [job] = await o.jobs("receipt");
    const receipt = job!.payload as CustomerReceipt;
    expect(receipt).toMatchObject({
      subtotalCents: 325_000,
      discountCents: 32_500,
      deliveryFeeCents: 30_000,
      totalCents: 322_500,
      taxIncludedCents: 13_900, // food only: 2,925 × 5 / 105 = 139.29 → 139
      taxRateBp: 500,
      tenderedCents: 500_000,
      changeCents: 177_500,
      cashierName: "المدير",
    });
    expect(receipt.lines[0]).toMatchObject({ nameAr: "بيتزا السلطان", nameEn: "Sultan Pizza", sizeEn: "Large", totalCents: 220_000 });
  });

  it("takes part payments and prints only when paid in full", async () => {
    const o = await sentOrder("dine_in");
    expect((await o.money.pay(o.orderId, { method: "cash", tenderedPounds: 2000 }, o.staffId)).totals).toMatchObject({
      status: "part_paid",
      balanceCents: 125_000,
    });
    expect(await o.jobs("receipt")).toEqual([]);
    await o.money.pay(o.orderId, { method: "cash", tenderedPounds: 1250 }, o.staffId);
    expect(await o.jobs("receipt")).toHaveLength(1);
    await expect(o.money.pay(o.orderId, { method: "cash", tenderedPounds: 100 }, o.staffId)).rejects.toMatchObject({ code: "paid" });
  });

  it("does not change the discount or fee after a payment", async () => {
    const o = await sentOrder();
    await o.money.pay(o.orderId, { method: "cash", tenderedPounds: 1000 }, o.staffId);
    await expect(o.money.discount(o.orderId, { amountPounds: 100 }, o.staffId, o.staffId)).rejects.toMatchObject({ code: "has_payments" });
    await expect(o.money.deliveryFee(o.orderId, 200, o.staffId)).rejects.toMatchObject({ code: "has_payments" });
  });

  it("only charges a delivery fee on delivery orders", async () => {
    const o = await sentOrder("pickup");
    await expect(o.money.deliveryFee(o.orderId, 200, o.staffId)).rejects.toMatchObject({ code: "not_delivery" });
  });

  it("voids an unpaid order and refuses to take money for it", async () => {
    const o = await sentOrder();
    const totals = await o.money.void(o.orderId, "customer_cancelled", "", o.staffId);
    expect(totals).toMatchObject({ status: "voided", balanceCents: 0 });
    await expect(o.money.pay(o.orderId, { method: "cash", tenderedPounds: 5000 }, o.staffId)).rejects.toBeInstanceOf(MoneyRefused);
    const detail = await o.money.detail(o.orderId);
    expect(detail.history.map((h) => [h.kind, h.reason, h.staffName])).toEqual([
      ["sent", null, "المدير"],
      ["void", "customer_cancelled", "المدير"],
    ]);
  });

  it("refunds a paid order but will not void it", async () => {
    const o = await sentOrder();
    await o.money.pay(o.orderId, { method: "cash", tenderedPounds: 3250 }, o.staffId);
    await expect(o.money.void(o.orderId, "wrong_order", "", o.staffId)).rejects.toMatchObject({ code: "has_payments" });
    expect(await o.money.refund(o.orderId, "wrong_order", "pizza burnt", o.staffId)).toMatchObject({ status: "refunded", paidCents: 0 });
    await expect(o.money.refund(o.orderId, "wrong_order", "", o.staffId)).rejects.toMatchObject({ code: "refunded" });
  });

  it("refuses a discount bigger than the order", async () => {
    const o = await sentOrder();
    await expect(o.money.discount(o.orderId, { amountPounds: 5000 }, o.staffId, o.staffId)).rejects.toMatchObject({ code: "too_much" });
  });

  it("reprints the kitchen ticket and the receipt", async () => {
    const o = await sentOrder();
    await o.money.reprint(o.orderId, "kitchen");
    await o.money.reprint(o.orderId, "receipt");
    const kitchen = await o.jobs("kitchen");
    expect(kitchen.map((j) => (j.payload as KitchenTicket).reprint)).toEqual([false, true]);
    expect(((await o.jobs("receipt"))[0]!.payload as CustomerReceipt).status).toBe("unpaid");
  });

  it("keeps the tax rate an order was sent with", async () => {
    const o = await sentOrder();
    await o.settings.update({ tax: { rateBp: 1000, nameAr: "ضريبة", nameEn: "Tax" } }, o.staffId);
    expect((await o.money.detail(o.orderId)).totals.taxIncludedCents).toBe(15_500);
  });

  it("finds a manager to approve, but not a cashier", async () => {
    const o = await sentOrder();
    expect(await o.auth.approver("1234")).toMatchObject({ role: "admin" });
    expect(await o.auth.approver("9999")).toBeNull();
  });

  it("never shows another restaurant's orders", async () => {
    const a = await sentOrder();
    const b = await sentOrder();
    expect((await b.money.today()).map((o) => o.id)).not.toContain(a.orderId);
    await expect(b.money.pay(a.orderId, { method: "cash", tenderedPounds: 100 }, b.staffId)).rejects.toMatchObject({ code: "not_found" });
  });
});

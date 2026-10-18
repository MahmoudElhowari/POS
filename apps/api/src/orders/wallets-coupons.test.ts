import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, printJobs, runMigrations } from "@pos/db";
import type { CustomerReceipt, OrderDraft } from "@pos/shared";
import { createAuditLog } from "../audit.js";
import { createAuthStore } from "../auth/store.js";
import { createCouponStore } from "../coupons.js";
import { createDayStore } from "../days.js";
import { createMenuStore } from "../menu/store.js";
import { menuSeed } from "../menu/types.js";
import { createSettingsStore } from "../settings.js";
import { createMoneyStore } from "./money.js";
import { createOrderStore } from "./store.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("wallets and coupons (Postgres)", () => {
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
    const coupons = createCouponStore(db, tenantId, createAuditLog(db, tenantId));
    const all = (await menu.adminMenu()).categories.flatMap((c) => c.items);
    const item = (nameEn: string) => all.find((i) => i.nameEn === nameEn)!.id;
    const staffId = staff.staffId;
    /** Corn Regular (750) + a can of soda (100) = 850. */
    const send = (name = "ريم") =>
      orders.send(
        {
          type: "pickup",
          customer: { name },
          lines: [
            { itemId: item("Corn Pizza"), sizeKey: "regular", addons: [], removals: [], qty: 1 },
            { itemId: item("Soda"), sizeKey: "can", addons: [], removals: [], qty: 1 },
          ],
        } satisfies OrderDraft,
        staffId,
        85_000,
      );
    const receipts = async () =>
      (
        await db
          .select()
          .from(printJobs)
          .where(and(eq(printJobs.tenantId, tenantId), eq(printJobs.kind, "receipt")))
      ).map((j) => j.payload as CustomerReceipt);
    return { tenantId, staffId, settings, days, money, coupons, send, receipts };
  }

  it("splits a bill between a wallet and cash, and keeps the wallet out of the drawer", async () => {
    const s = await store();
    const o = await s.send();
    await expect(s.money.pay(o.id, { method: "wallet", wallet: "syriatel", amountPounds: 900, reference: "A1" }, s.staffId)).rejects.toMatchObject({
      code: "over_due",
    });
    await expect(s.money.pay(o.id, { method: "wallet", wallet: "nope", amountPounds: 500, reference: "A1" }, s.staffId)).rejects.toMatchObject({
      code: "no_wallet",
    });

    const part = await s.money.pay(o.id, { method: "wallet", wallet: "syriatel", amountPounds: 500, reference: "TX-889" }, s.staffId);
    expect(part.totals).toMatchObject({ status: "part_paid", balanceCents: 35_000 });
    expect(await s.receipts()).toEqual([]);
    const rest = await s.money.pay(o.id, { method: "cash", tenderedPounds: 500 }, s.staffId);
    expect(rest).toMatchObject({ totals: { status: "paid" }, changeCents: 15_000 });

    const [receipt] = await s.receipts();
    expect(receipt!.payments).toEqual([
      { method: "wallet", nameAr: "سيريتل كاش", amountCents: 50_000, tenderedCents: 50_000, changeCents: 0, reference: "TX-889" },
      { method: "cash", nameAr: "نقداً", amountCents: 35_000, tenderedCents: 50_000, changeCents: 15_000, reference: null },
    ]);
    const { report } = await s.days.x();
    expect(report).toMatchObject({
      cashCents: 35_000,
      cashCount: 1,
      wallets: [{ name: "سيريتل كاش", count: 1, amountCents: 50_000 }],
      expectedCashCents: 35_000,
    });
  });

  it("refunds each part the way it was paid", async () => {
    const s = await store();
    const o = await s.send();
    await s.money.pay(o.id, { method: "wallet", wallet: "mtn", amountPounds: 600, reference: "M-1" }, s.staffId);
    await s.money.pay(o.id, { method: "cash", tenderedPounds: 250 }, s.staffId);
    expect((await s.money.refund(o.id, "customer_cancelled", "", s.staffId)).status).toBe("refunded");
    const history = (await s.money.detail(o.id)).history.filter((e) => e.kind === "refund");
    expect(history.map((e) => [e.amountCents, e.walletName])).toEqual(
      expect.arrayContaining([
        [60_000, "MTN كاش"],
        [25_000, null],
      ]),
    );
    const { report } = await s.days.x();
    // Only the cash refund leaves the drawer.
    expect(report).toMatchObject({ refundCents: 85_000, refundCount: 2, cashRefundCents: 25_000, expectedCashCents: 0 });
  });

  it("keeps a wallet's old name on past payments after a rename, and refuses a wallet that is off", async () => {
    const s = await store();
    const o = await s.send();
    await s.money.pay(o.id, { method: "wallet", wallet: "sham", amountPounds: 100, reference: "S-1" }, s.staffId);
    const wallets = (await s.settings.get("wallets")).map((w) => (w.key === "sham" ? { ...w, nameAr: "شام كاش الجديدة" } : { ...w, active: w.key !== "mtn" }));
    await s.settings.update({ wallets }, s.staffId);
    await expect(s.money.pay(o.id, { method: "wallet", wallet: "mtn", amountPounds: 100, reference: "M-1" }, s.staffId)).rejects.toMatchObject({
      code: "no_wallet",
    });
    await s.money.pay(o.id, { method: "wallet", wallet: "sham", amountPounds: 750, reference: "S-2" }, s.staffId);
    const { report } = await s.days.x();
    expect(report.wallets).toEqual([
      { name: "شام كاش الجديدة", count: 1, amountCents: 75_000 },
      { name: "شام كاش", count: 1, amountCents: 10_000 },
    ]);
  });

  it("takes a coupon off the food without a manager, and shows it on the receipt and the report", async () => {
    const s = await store();
    await s.coupons.add({ code: "pizza10", percentBp: 1_000 }, s.staffId);
    const o = await s.send();
    await expect(s.money.coupon(o.id, "NOPE", s.staffId)).rejects.toMatchObject({ code: "no_coupon" });
    // 10% of 850 = 85.
    const applied = await s.money.coupon(o.id, " Pizza10 ", s.staffId);
    expect(applied).toMatchObject({ code: "PIZZA10", amountCents: 8_500, totals: { discountCents: 8_500, totalCents: 76_500 } });
    await s.money.pay(o.id, { method: "cash", tenderedPounds: 765 }, s.staffId);
    expect((await s.receipts())[0]).toMatchObject({ discountCents: 8_500, couponCode: "PIZZA10" });
    const { report } = await s.days.x();
    expect(report.coupons).toEqual([{ code: "PIZZA10", orders: 1, amountCents: 8_500 }]);
    expect(report.discounts).toEqual([{ number: 1, amountCents: 8_500, approvedBy: null, coupon: "PIZZA10" }]);
    expect((await s.coupons.list())[0]).toMatchObject({ code: "PIZZA10", uses: 1 });
  });

  it("refuses a coupon that is off, past its last day or used up, and a voided order gives its use back", async () => {
    const s = await store();
    const today = (await s.days.x()).day.date;
    const id = await s.coupons.add({ code: "ONCE", amountPounds: 100, maxUses: 1 }, s.staffId);
    await s.coupons.add({ code: "OLD", amountPounds: 100, endsOn: "2020-01-01" }, s.staffId);
    await s.coupons.add({ code: "TODAY", amountPounds: 100, endsOn: today }, s.staffId);
    const a = await s.send("أ");
    const b = await s.send("ب");
    await s.money.coupon(a.id, "ONCE", s.staffId);
    // Using it again on the same order is not a second use.
    await s.money.coupon(a.id, "ONCE", s.staffId);
    await expect(s.money.coupon(b.id, "ONCE", s.staffId)).rejects.toMatchObject({ code: "used_up" });
    await expect(s.money.coupon(b.id, "OLD", s.staffId)).rejects.toMatchObject({ code: "expired" });
    await s.money.coupon(b.id, "TODAY", s.staffId);

    await s.money.void(a.id, "customer_cancelled", "", s.staffId);
    await s.money.coupon(b.id, "ONCE", s.staffId);
    await s.coupons.update(id, { active: false }, s.staffId);
    const c = await s.send("ج");
    await expect(s.money.coupon(c.id, "ONCE", s.staffId)).rejects.toMatchObject({ code: "inactive" });
    // b's coupon replaced its earlier one, so TODAY has no uses left on it.
    expect((await s.coupons.list()).map((x) => [x.code, x.uses])).toEqual([
      ["OLD", 0],
      ["TODAY", 0],
      ["ONCE", 1],
    ]);
  });

  it("refuses a coupon on an order that already has a payment", async () => {
    const s = await store();
    await s.coupons.add({ code: "LATE", amountPounds: 100 }, s.staffId);
    const o = await s.send();
    await s.money.pay(o.id, { method: "cash", tenderedPounds: 100 }, s.staffId);
    await expect(s.money.coupon(o.id, "LATE", s.staffId)).rejects.toMatchObject({ code: "has_payments" });
  });

  it("gives two tablets one last use between them", async () => {
    const s = await store();
    await s.coupons.add({ code: "LAST", amountPounds: 100, maxUses: 1 }, s.staffId);
    const a = await s.send("أ");
    const b = await s.send("ب");
    const results = await Promise.allSettled([s.money.coupon(a.id, "LAST", s.staffId), s.money.coupon(b.id, "LAST", s.staffId)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("never shows or uses another restaurant's coupons", async () => {
    const a = await store();
    const b = await store();
    await a.coupons.add({ code: "MINE", percentBp: 5_000 }, a.staffId);
    expect(await b.coupons.list()).toEqual([]);
    const o = await b.send();
    await expect(b.money.coupon(o.id, "MINE", b.staffId)).rejects.toMatchObject({ code: "no_coupon" });
    // The same code can exist in both.
    await b.coupons.add({ code: "MINE", amountPounds: 50 }, b.staffId);
    await expect(a.coupons.add({ code: "mine", amountPounds: 50 }, a.staffId)).rejects.toMatchObject({ code: "duplicate" });
  });
});

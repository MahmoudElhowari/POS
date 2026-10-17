import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pos/db";
import { createAuthStore } from "../auth/store.js";
import { createMenuStore } from "./store.js";
import { menuSeed } from "./types.js";

const url = process.env.TEST_DATABASE_URL;
const romantica = menuSeed.parse(JSON.parse(readFileSync(new URL("../../../../db/seed/romantica-menu.json", import.meta.url), "utf8")));

describe.skipIf(!url)("menu store (Postgres)", () => {
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
    return { tenantId, menu, auth, staffId: staff.staffId };
  }

  const find = (menu: Awaited<ReturnType<ReturnType<typeof createMenuStore>["adminMenu"]>>, nameEn: string) =>
    menu.categories.flatMap((c) => c.items).find((i) => i.nameEn === nameEn)!;

  it("loads the whole Romantica menu", async () => {
    const { menu } = await freshStore();
    const all = await menu.adminMenu();
    expect(all.categories.map((c) => c.key)).toEqual(["classics", "specialties", "calzones", "sides", "salads", "drinks"]);
    expect(all.categories.flatMap((c) => c.items)).toHaveLength(46);
    expect(find(all, "Sultan Pizza").sizes.map((s) => s.priceCents)).toEqual([110_000, 220_000]);
    expect(find(all, "Friends Pizza").includedAddons).toEqual(["cheese", "sujuq"]);
  });

  it("hides unpriced and unavailable items from the order screen", async () => {
    const { menu } = await freshStore();
    const pub = await menu.publicMenu();
    const names = pub.categories.flatMap((c) => c.items.map((i) => i.nameEn));
    expect(names).not.toContain("Margherita Pizza"); // no price yet
    expect(names).toContain("Sultan Pizza");
    // Only the cheese crust is priced so far; the others are listed without prices.
    expect(pub.addons.filter((a) => Object.keys(a.prices).length).map((a) => a.key)).toEqual(["cheese"]);
    expect(pub.addons.find((a) => a.key === "sujuq")).toMatchObject({ group: "crust_stuffing", prices: {} });

    const sultan = find(await menu.adminMenu(), "Sultan Pizza");
    await menu.updateItem(sultan.id, { available: false });
    const after = (await menu.publicMenu()).categories.flatMap((c) => c.items.map((i) => i.nameEn));
    expect(after).not.toContain("Sultan Pizza");
  });

  it("re-importing changes nothing and logs no price changes", async () => {
    const { menu } = await freshStore();
    expect(await menu.importSeed(romantica)).toEqual({ pricesChanged: 0 });
    expect((await menu.adminMenu()).categories.flatMap((c) => c.items)).toHaveLength(46);
  });

  it("logs who changed a price and from what", async () => {
    const { menu, staffId } = await freshStore();
    const margherita = find(await menu.adminMenu(), "Margherita Pizza");
    const large = margherita.sizes.find((s) => s.sizeKey === "large")!;
    await menu.updateSize(large.id, { pricePounds: 1800 }, staffId);
    await menu.updateSize(large.id, { pricePounds: 1900 }, staffId);
    const history = await menu.priceHistoryFor([large.id]);
    expect(history.map((h) => [h.oldCents, h.newCents, h.reason])).toEqual([
      [null, 180_000, "edit"],
      [180_000, 190_000, "edit"],
    ]);
    expect((await menu.publicMenu()).categories.flatMap((c) => c.items).find((i) => i.nameEn === "Margherita Pizza")?.sizes).toEqual([
      expect.objectContaining({ sizeKey: "large", priceCents: 190_000 }),
    ]);
  });

  it("previews and applies a bulk change rounded to whole pounds", async () => {
    const { menu, staffId } = await freshStore();
    const preview = await menu.bulkPreview(700);
    const corn = preview.find((r) => r.nameAr === "بيتزا ذرة" && r.oldCents === 75_000)!;
    expect(corn.newCents).toBe(80_300); // 802.5 → 803
    expect(preview.every((r) => r.newCents % 100 === 0)).toBe(true);

    const changed = await menu.bulkApply(700, staffId);
    expect(changed).toBe(preview.filter((r) => r.oldCents !== r.newCents).length);
    const sultan = find(await menu.adminMenu(), "Sultan Pizza");
    expect(sultan.sizes.map((s) => s.priceCents)).toEqual([117_700, 235_400]);
    const history = await menu.priceHistoryFor([sultan.sizes[0]!.id]);
    expect(history.at(-1)).toMatchObject({ oldCents: 110_000, newCents: 117_700, reason: "bulk" });
  });

  it("never touches another restaurant's menu", async () => {
    const a = await freshStore();
    const b = await freshStore();
    const aSultan = find(await a.menu.adminMenu(), "Sultan Pizza");
    await expect(b.menu.updateSize(aSultan.sizes[0]!.id, { pricePounds: 1 }, b.staffId)).rejects.toThrow();
    await b.menu.bulkApply(5_000, b.staffId);
    expect(find(await a.menu.adminMenu(), "Sultan Pizza").sizes[0]!.priceCents).toBe(110_000);
  });

  it("creates a new item in a category", async () => {
    const { menu, staffId } = await freshStore();
    const cat = (await menu.adminMenu()).categories.find((c) => c.key === "drinks")!;
    await menu.createItem(
      { categoryId: cat.id, nameAr: "عصير برتقال", nameEn: "Orange Juice", descAr: "", descEn: "", sizes: [{ sizeKey: "one", nameAr: "حجم واحد", nameEn: "One size", pricePounds: 200 }] },
      staffId,
    );
    expect(find(await menu.adminMenu(), "Orange Juice").sizes[0]!.priceCents).toBe(20_000);
  });
});

describe.skipIf(!url)("auth store (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  it("creates the first admin once, signs in, and signs out", async () => {
    const auth = createAuthStore(db, `t-${randomUUID()}`);
    expect(await auth.ensureInitialAdmin("4321")).toBe(true);
    expect(await auth.ensureInitialAdmin("9999")).toBe(false);
    expect(await auth.login("9999")).toBeNull();
    const result = await auth.login("4321");
    expect(result?.staff.role).toBe("admin");
    expect(await auth.session(result!.token)).toMatchObject({ role: "admin" });
    await auth.logout(result!.token);
    expect(await auth.session(result!.token)).toBeNull();
  });

  it("does not accept a session from another restaurant", async () => {
    const a = createAuthStore(db, `t-${randomUUID()}`);
    await a.ensureInitialAdmin("5555");
    const { token } = (await a.login("5555"))!;
    expect(await createAuthStore(db, `t-${randomUUID()}`).session(token)).toBeNull();
  });

  it("expires a session after 10 idle minutes", async () => {
    const auth = createAuthStore(db, `t-${randomUUID()}`);
    await auth.ensureInitialAdmin("6666");
    const { token, staff } = (await auth.login("6666"))!;
    await pool.query(`update sessions set last_seen_at = now() - interval '11 minutes' where staff_id = $1`, [staff.staffId]);
    expect(await auth.session(token)).toBeNull();
  });
});

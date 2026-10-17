import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  addonPrices,
  addons,
  type Db,
  itemSizes,
  menuCategories,
  menuItems,
  priceChanges,
  priceHistory,
} from "@pos/db";
import { bulkChange } from "@pos/shared";
import type { AdminMenu, BulkRow, MenuSeed, PublicMenu } from "./types.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type PriceTarget = "item_size" | "addon_price";

export class NotFound extends Error {}

// Add-on prices are keyed by pizza size.
const ADDON_SIZE_AR: Record<string, string> = { regular: "وسط", large: "كبير" };

/** All menu access for one restaurant; every query filters by tenant. */
export function createMenuStore(db: Db, tenantId: string) {
  async function recordChange(
    tx: Tx,
    reason: "edit" | "bulk" | "import",
    rows: { target: PriceTarget; targetId: string; oldCents: number | null; newCents: number | null }[],
    staffId: string | null,
    percentBp: number | null = null,
  ) {
    const changed = rows.filter((r) => r.oldCents !== r.newCents);
    if (!changed.length) return 0;
    const [change] = await tx.insert(priceChanges).values({ tenantId, reason, staffId, percentBp }).returning();
    await tx.insert(priceHistory).values(changed.map((r) => ({ tenantId, changeId: change!.id, ...r })));
    return changed.length;
  }

  async function adminMenu(): Promise<AdminMenu> {
    const cats = await db.select().from(menuCategories).where(eq(menuCategories.tenantId, tenantId)).orderBy(asc(menuCategories.sort));
    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.tenantId, tenantId))
      .orderBy(asc(menuItems.sort), asc(menuItems.nameAr));
    const sizes = await db.select().from(itemSizes).where(eq(itemSizes.tenantId, tenantId)).orderBy(asc(itemSizes.sort));
    const adds = await db.select().from(addons).where(eq(addons.tenantId, tenantId)).orderBy(asc(addons.sort));
    const aPrices = await db.select().from(addonPrices).where(eq(addonPrices.tenantId, tenantId));

    return {
      categories: cats.map((c) => ({
        id: c.id,
        key: c.key,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        kind: c.kind,
        items: items
          .filter((i) => i.categoryId === c.id)
          .map((i) => ({
            id: i.id,
            key: i.key,
            nameAr: i.nameAr,
            nameEn: i.nameEn,
            descAr: i.descAr,
            descEn: i.descEn,
            halfAndHalf: i.halfAndHalf,
            removable: i.removable,
            includedAddons: i.includedAddons,
            available: i.available,
            sort: i.sort,
            sizes: sizes
              .filter((s) => s.itemId === i.id)
              .map((s) => ({
                id: s.id,
                sizeKey: s.sizeKey,
                nameAr: s.nameAr,
                nameEn: s.nameEn,
                priceCents: s.priceCents,
                available: s.available,
              })),
          })),
      })),
      addons: adds.map((a) => ({
        id: a.id,
        key: a.key,
        group: a.group,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        available: a.available,
        prices: aPrices.filter((p) => p.addonId === a.id).map((p) => ({ id: p.id, sizeKey: p.sizeKey, priceCents: p.priceCents })),
      })),
    };
  }

  /** Every priced item size and add-on price, before and after the change. */
  async function bulkPreview(percentBp: number, tx: Tx | Db = db): Promise<BulkRow[]> {
    const sizes = await tx
      .select({ id: itemSizes.id, priceCents: itemSizes.priceCents, nameAr: menuItems.nameAr, sizeAr: itemSizes.nameAr })
      .from(itemSizes)
      .innerJoin(menuItems, eq(menuItems.id, itemSizes.itemId))
      .where(and(eq(itemSizes.tenantId, tenantId), isNotNull(itemSizes.priceCents)))
      .orderBy(asc(menuItems.sort), asc(itemSizes.sort));
    const aPrices = await tx
      .select({ id: addonPrices.id, priceCents: addonPrices.priceCents, nameAr: addons.nameAr, sizeKey: addonPrices.sizeKey })
      .from(addonPrices)
      .innerJoin(addons, eq(addons.id, addonPrices.addonId))
      .where(and(eq(addonPrices.tenantId, tenantId), isNotNull(addonPrices.priceCents)));
    return [
      ...sizes.map((s) => ({ target: "item_size" as const, id: s.id, nameAr: s.nameAr, sizeAr: s.sizeAr, oldCents: s.priceCents!, newCents: bulkChange(s.priceCents!, percentBp) })),
      ...aPrices.map((a) => ({ target: "addon_price" as const, id: a.id, nameAr: a.nameAr, sizeAr: ADDON_SIZE_AR[a.sizeKey] ?? a.sizeKey, oldCents: a.priceCents!, newCents: bulkChange(a.priceCents!, percentBp) })),
    ];
  }

  return {
    adminMenu,
    bulkPreview,

    /** What the order screen may sell: available, priced items and add-ons only. */
    async publicMenu(): Promise<PublicMenu> {
      const menu = await adminMenu();
      return {
        categories: menu.categories
          .map((c) => ({
            ...c,
            items: c.items
              .filter((i) => i.available)
              .map(({ available: _a, sort: _s, ...i }) => ({
                ...i,
                sizes: i.sizes
                  .filter((s) => s.available && s.priceCents !== null)
                  .map(({ available: _x, ...s }) => ({ ...s, priceCents: s.priceCents! })),
              }))
              .filter((i) => i.sizes.length > 0),
          }))
          .filter((c) => c.items.length > 0),
        addons: menu.addons
          .filter((a) => a.available)
          .map(({ available: _a, prices, ...a }) => ({
            ...a,
            prices: Object.fromEntries(prices.filter((p) => p.priceCents !== null).map((p) => [p.sizeKey, p.priceCents!])),
          }))
          .filter((a) => Object.keys(a.prices).length > 0),
      };
    },

    async isEmpty() {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(menuCategories).where(eq(menuCategories.tenantId, tenantId));
      return (row?.n ?? 0) === 0;
    },

    /**
     * Loads a menu file. Idempotent: matches by key, updates in place, and logs
     * every price that moved. Things not in the file are left alone.
     */
    async importSeed(seed: MenuSeed, staffId: string | null = null) {
      return db.transaction(async (tx) => {
        const history: { target: PriceTarget; targetId: string; oldCents: number | null; newCents: number | null }[] = [];

        for (const [ci, c] of seed.categories.entries()) {
          const [cat] = await tx
            .insert(menuCategories)
            .values({ tenantId, key: c.key, nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, sort: ci })
            .onConflictDoUpdate({
              target: [menuCategories.tenantId, menuCategories.key],
              set: { nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, sort: ci },
            })
            .returning();

          for (const [ii, it] of c.items.entries()) {
            const fields = {
              categoryId: cat!.id,
              nameAr: it.nameAr,
              nameEn: it.nameEn,
              descAr: it.descAr,
              descEn: it.descEn,
              halfAndHalf: it.halfAndHalf,
              includedAddons: it.includedAddons,
              removable: it.removable,
              sort: ii,
            };
            const [item] = await tx
              .insert(menuItems)
              .values({ tenantId, key: it.key, ...fields })
              .onConflictDoUpdate({ target: [menuItems.tenantId, menuItems.key], set: fields })
              .returning();

            for (const [si, s] of it.sizes.entries()) {
              const [old] = await tx
                .select()
                .from(itemSizes)
                .where(and(eq(itemSizes.itemId, item!.id), eq(itemSizes.sizeKey, s.sizeKey)));
              const [row] = await tx
                .insert(itemSizes)
                .values({ tenantId, itemId: item!.id, sizeKey: s.sizeKey, nameAr: s.nameAr, nameEn: s.nameEn, priceCents: s.priceCents, sort: si })
                .onConflictDoUpdate({
                  target: [itemSizes.itemId, itemSizes.sizeKey],
                  set: { nameAr: s.nameAr, nameEn: s.nameEn, priceCents: s.priceCents, sort: si },
                })
                .returning();
              history.push({ target: "item_size", targetId: row!.id, oldCents: old?.priceCents ?? null, newCents: s.priceCents });
            }
          }
        }

        for (const [ai, a] of seed.addons.entries()) {
          const [addon] = await tx
            .insert(addons)
            .values({ tenantId, key: a.key, group: a.group, nameAr: a.nameAr, nameEn: a.nameEn, sort: ai })
            .onConflictDoUpdate({ target: [addons.tenantId, addons.key], set: { group: a.group, nameAr: a.nameAr, nameEn: a.nameEn, sort: ai } })
            .returning();
          for (const [sizeKey, priceCents] of Object.entries(a.prices)) {
            const [old] = await tx
              .select()
              .from(addonPrices)
              .where(and(eq(addonPrices.addonId, addon!.id), eq(addonPrices.sizeKey, sizeKey)));
            const [row] = await tx
              .insert(addonPrices)
              .values({ tenantId, addonId: addon!.id, sizeKey, priceCents })
              .onConflictDoUpdate({ target: [addonPrices.addonId, addonPrices.sizeKey], set: { priceCents } })
              .returning();
            history.push({ target: "addon_price", targetId: row!.id, oldCents: old?.priceCents ?? null, newCents: priceCents });
          }
        }

        return { pricesChanged: await recordChange(tx, "import", history, staffId) };
      });
    },

    async createItem(
      input: { categoryId: string; nameAr: string; nameEn: string; descAr: string; descEn: string; sizes: { sizeKey: string; nameAr: string; nameEn: string; pricePounds: number | null }[] },
      staffId: string,
    ) {
      return db.transaction(async (tx) => {
        const [cat] = await tx
          .select()
          .from(menuCategories)
          .where(and(eq(menuCategories.id, input.categoryId), eq(menuCategories.tenantId, tenantId)));
        if (!cat) throw new NotFound("category");
        const [item] = await tx
          .insert(menuItems)
          .values({
            tenantId,
            categoryId: cat.id,
            key: `item-${crypto.randomUUID().slice(0, 8)}`,
            nameAr: input.nameAr,
            nameEn: input.nameEn,
            descAr: input.descAr,
            descEn: input.descEn,
            halfAndHalf: cat.kind === "pizza",
            sort: 1_000,
          })
          .returning();
        const sizes = await tx
          .insert(itemSizes)
          .values(
            input.sizes.map((s, i) => ({
              tenantId,
              itemId: item!.id,
              sizeKey: s.sizeKey,
              nameAr: s.nameAr,
              nameEn: s.nameEn,
              priceCents: s.pricePounds === null ? null : s.pricePounds * 100,
              sort: i,
            })),
          )
          .returning();
        await recordChange(
          tx,
          "edit",
          sizes.map((s) => ({ target: "item_size" as const, targetId: s.id, oldCents: null, newCents: s.priceCents })),
          staffId,
        );
        return item!.id;
      });
    },

    async updateItem(id: string, patch: Partial<typeof menuItems.$inferInsert>) {
      if (!Object.keys(patch).length) return;
      const rows = await db
        .update(menuItems)
        .set(patch)
        .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, tenantId)))
        .returning({ id: menuItems.id });
      if (!rows.length) throw new NotFound("item");
    },

    async updateSize(id: string, patch: { pricePounds?: number | null; available?: boolean }, staffId: string) {
      await db.transaction(async (tx) => {
        const [old] = await tx.select().from(itemSizes).where(and(eq(itemSizes.id, id), eq(itemSizes.tenantId, tenantId)));
        if (!old) throw new NotFound("size");
        const set: Partial<typeof itemSizes.$inferInsert> = {};
        if (patch.available !== undefined) set.available = patch.available;
        if (patch.pricePounds !== undefined) set.priceCents = patch.pricePounds === null ? null : patch.pricePounds * 100;
        if (!Object.keys(set).length) return;
        await tx.update(itemSizes).set(set).where(eq(itemSizes.id, id));
        if (set.priceCents !== undefined) {
          await recordChange(tx, "edit", [{ target: "item_size", targetId: id, oldCents: old.priceCents, newCents: set.priceCents }], staffId);
        }
      });
    },

    async updateAddon(id: string, patch: Partial<typeof addons.$inferInsert>) {
      if (!Object.keys(patch).length) return;
      const rows = await db
        .update(addons)
        .set(patch)
        .where(and(eq(addons.id, id), eq(addons.tenantId, tenantId)))
        .returning({ id: addons.id });
      if (!rows.length) throw new NotFound("addon");
    },

    async setAddonPrice(id: string, pricePounds: number | null, staffId: string) {
      await db.transaction(async (tx) => {
        const [old] = await tx.select().from(addonPrices).where(and(eq(addonPrices.id, id), eq(addonPrices.tenantId, tenantId)));
        if (!old) throw new NotFound("addon price");
        const priceCents = pricePounds === null ? null : pricePounds * 100;
        await tx.update(addonPrices).set({ priceCents }).where(eq(addonPrices.id, id));
        await recordChange(tx, "edit", [{ target: "addon_price", targetId: id, oldCents: old.priceCents, newCents: priceCents }], staffId);
      });
    },

    async bulkApply(percentBp: number, staffId: string) {
      return db.transaction(async (tx) => {
        // Lock this restaurant's prices so two managers cannot apply at once.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bulk:${tenantId}`}))`);
        const rows = (await bulkPreview(percentBp, tx)).filter((r) => r.oldCents !== r.newCents);
        const sizeRows = rows.filter((r) => r.target === "item_size");
        const addonRows = rows.filter((r) => r.target === "addon_price");
        for (const r of sizeRows) await tx.update(itemSizes).set({ priceCents: r.newCents }).where(eq(itemSizes.id, r.id));
        for (const r of addonRows) await tx.update(addonPrices).set({ priceCents: r.newCents }).where(eq(addonPrices.id, r.id));
        return recordChange(
          tx,
          "bulk",
          rows.map((r) => ({ target: r.target, targetId: r.id, oldCents: r.oldCents, newCents: r.newCents })),
          staffId,
          percentBp,
        );
      });
    },

    async priceHistoryFor(targetIds: string[]) {
      if (!targetIds.length) return [];
      return db
        .select({ targetId: priceHistory.targetId, oldCents: priceHistory.oldCents, newCents: priceHistory.newCents, reason: priceChanges.reason, at: priceChanges.createdAt })
        .from(priceHistory)
        .innerJoin(priceChanges, eq(priceChanges.id, priceHistory.changeId))
        .where(and(eq(priceHistory.tenantId, tenantId), inArray(priceHistory.targetId, targetIds)))
        .orderBy(asc(priceChanges.createdAt));
    },
  };
}

export type MenuStore = ReturnType<typeof createMenuStore>;

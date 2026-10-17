import { z } from "zod";

const ingredient = z.object({ ar: z.string().min(1), en: z.string() });
const cents = z.number().int().nonnegative().nullable();

/** Shape of db/seed/*.json and of the import endpoint. */
export const menuSeed = z.object({
  categories: z.array(
    z.object({
      key: z.string().min(1),
      nameAr: z.string().min(1),
      nameEn: z.string().default(""),
      kind: z.enum(["pizza", "calzone", "other"]),
      items: z.array(
        z.object({
          key: z.string().min(1),
          nameAr: z.string().min(1),
          nameEn: z.string().default(""),
          descAr: z.string().default(""),
          descEn: z.string().default(""),
          halfAndHalf: z.boolean().default(false),
          includedAddons: z.array(z.string()).default([]),
          removable: z.array(ingredient).default([]),
          sizes: z
            .array(z.object({ sizeKey: z.string().min(1), nameAr: z.string().min(1), nameEn: z.string().default(""), priceCents: cents }))
            .min(1),
        }),
      ),
    }),
  ),
  addons: z.array(
    z.object({
      key: z.string().min(1),
      group: z.enum(["crust_stuffing", "extra"]),
      nameAr: z.string().min(1),
      nameEn: z.string().default(""),
      prices: z.record(z.string(), cents),
    }),
  ),
});
export type MenuSeed = z.infer<typeof menuSeed>;

/** Prices travel as whole pounds in the admin API and as cents in storage. */
const pounds = z.number().int().nonnegative().max(10_000_000);

export const itemPatch = z
  .object({
    nameAr: z.string().trim().min(1),
    nameEn: z.string().trim(),
    descAr: z.string().trim(),
    descEn: z.string().trim(),
    available: z.boolean(),
    sort: z.number().int(),
    removable: z.array(ingredient),
    includedAddons: z.array(z.string()).max(2),
  })
  .partial();

export const sizePatch = z.object({ pricePounds: pounds.nullable(), available: z.boolean() }).partial();
export const addonPatch = z.object({ nameAr: z.string().trim().min(1), nameEn: z.string().trim(), available: z.boolean() }).partial();
export const addonPricePatch = z.object({ pricePounds: pounds.nullable() });
export const bulkRequest = z.object({ percentBp: z.number().int().min(-9_000).max(100_000) });

export const newItem = z.object({
  categoryId: z.uuid(),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().default(""),
  descAr: z.string().trim().default(""),
  descEn: z.string().trim().default(""),
  sizes: z.array(z.object({ sizeKey: z.string().min(1), nameAr: z.string().min(1), nameEn: z.string().default(""), pricePounds: pounds.nullable() })).min(1),
});

export interface PublicMenu {
  categories: {
    id: string;
    key: string;
    nameAr: string;
    nameEn: string;
    kind: "pizza" | "calzone" | "other";
    items: {
      id: string;
      key: string;
      nameAr: string;
      nameEn: string;
      descAr: string;
      descEn: string;
      halfAndHalf: boolean;
      removable: { ar: string; en: string }[];
      includedAddons: string[];
      sizes: { id: string; sizeKey: string; nameAr: string; nameEn: string; priceCents: number }[];
    }[];
  }[];
  addons: { id: string; key: string; group: "crust_stuffing" | "extra"; nameAr: string; nameEn: string; prices: Record<string, number> }[];
}

export interface AdminMenu {
  categories: (Omit<PublicMenu["categories"][number], "items"> & {
    items: (Omit<PublicMenu["categories"][number]["items"][number], "sizes"> & {
      available: boolean;
      sort: number;
      sizes: { id: string; sizeKey: string; nameAr: string; nameEn: string; priceCents: number | null; available: boolean }[];
    })[];
  })[];
  addons: (Omit<PublicMenu["addons"][number], "prices"> & {
    available: boolean;
    prices: { id: string; sizeKey: string; priceCents: number | null }[];
  })[];
}

export interface BulkRow {
  target: "item_size" | "addon_price";
  id: string;
  nameAr: string;
  sizeAr: string;
  oldCents: number;
  newCents: number;
}

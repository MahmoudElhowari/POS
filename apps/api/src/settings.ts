import { and, eq, sql } from "drizzle-orm";
import { type Db, settings } from "@pos/db";
import { z } from "zod";

// Per-restaurant settings (rule 9). Each key has a default, so a new store works
// before anyone opens the settings screen.

export const settingsSchema = {
  /** Tax included in the menu prices (Mahmoud, 2026-10-17: 5%, shown but never added). */
  tax: z.object({
    rateBp: z.number().int().min(0).max(5_000),
    nameAr: z.string().trim().min(1).max(30),
    nameEn: z.string().trim().max(30),
  }),
  /** Close of day (Milestone 5): the automatic close hour and the notes in the cash count. */
  day: z.object({
    /** If nobody runs a Z, the day ends at this hour, store time (Mahmoud: 4 AM). */
    autoCloseHour: z.number().int().min(0).max(12),
    notesPounds: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(20),
  }),
  /**
   * Mobile wallets the restaurant takes (Milestone 8). The key never changes, so
   * past payments keep pointing at the right wallet after a rename.
   */
  wallets: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_-]{1,30}$/),
        nameAr: z.string().trim().min(1).max(30),
        nameEn: z.string().trim().max(30),
        active: z.boolean(),
      }),
    )
    .max(12)
    .refine((list) => new Set(list.map((w) => w.key)).size === list.length, "duplicate wallet key"),
  /** Extra lines on the customer receipt. */
  receipt: z.object({
    phone: z.string().trim().max(40),
    address: z.string().trim().max(120),
    footer: z.string().trim().max(120),
  }),
};

export type Settings = { [K in keyof typeof settingsSchema]: z.infer<(typeof settingsSchema)[K]> };
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  tax: { rateBp: 500, nameAr: "ضريبة", nameEn: "Tax" },
  day: { autoCloseHour: 4, notesPounds: [10, 25, 50, 100, 200, 500] },
  receipt: { phone: "", address: "", footer: "" },
  wallets: [
    { key: "syriatel", nameAr: "سيريتل كاش", nameEn: "Syriatel Cash", active: true },
    { key: "mtn", nameAr: "MTN كاش", nameEn: "MTN Cash", active: true },
    { key: "sham", nameAr: "شام كاش", nameEn: "Sham Cash", active: true },
  ],
};

export const settingsPatch = z.object({
  tax: settingsSchema.tax.optional(),
  day: settingsSchema.day.optional(),
  receipt: settingsSchema.receipt.optional(),
  wallets: settingsSchema.wallets.optional(),
});

export function createSettingsStore(db: Db, tenantId: string) {
  return {
    async all(): Promise<Settings> {
      const rows = await db.select().from(settings).where(eq(settings.tenantId, tenantId));
      const out: Settings = structuredClone(DEFAULT_SETTINGS);
      for (const row of rows) {
        if (!(row.key in settingsSchema)) continue;
        const key = row.key as SettingKey;
        const parsed = settingsSchema[key].safeParse(row.value);
        // A bad stored value falls back to the default rather than breaking sales.
        if (parsed.success) (out as Record<SettingKey, unknown>)[key] = parsed.data;
      }
      return out;
    },

    async update(patch: Partial<Settings>, staffId: string) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        await db
          .insert(settings)
          .values({ tenantId, key, value, updatedBy: staffId })
          .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedBy: staffId, updatedAt: sql`now()` } });
      }
    },

    async get<K extends SettingKey>(key: K): Promise<Settings[K]> {
      const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, key)));
      const parsed = row ? settingsSchema[key].safeParse(row.value) : null;
      return (parsed?.success ? parsed.data : DEFAULT_SETTINGS[key]) as Settings[K];
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

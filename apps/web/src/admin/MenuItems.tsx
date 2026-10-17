import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdminAddon, AdminCategory, AdminItem } from "../api";
import { api } from "../api";
import { pounds } from "../format";
import { AddItem } from "./AddItem";
import { ItemEditor } from "./ItemEditor";

export function MenuItems({ categories, addons, reload }: { categories: AdminCategory[]; addons: AdminAddon[]; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const [catId, setCatId] = useState(categories[0]?.id);
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [adding, setAdding] = useState(false);
  const category = categories.find((c) => c.id === catId) ?? categories[0];

  async function toggle(item: AdminItem) {
    await api.updateItem(item.id, { available: !item.available });
    await reload();
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <nav className="flex gap-2 overflow-x-auto md:w-48 md:flex-col" aria-label={t("admin.tabs.items")}>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatId(c.id)}
            className={`min-h-12 shrink-0 rounded-xl px-4 text-start font-semibold ${c.id === category?.id ? "bg-red-700 text-white" : "bg-white"}`}
          >
            {c.nameAr}
          </button>
        ))}
      </nav>

      <div className="flex flex-1 flex-col gap-3">
        <button type="button" onClick={() => setAdding(true)} className="min-h-12 self-start rounded-xl bg-red-700 px-5 font-bold text-white">
          {t("admin.add.button")}
        </button>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {category?.items.map((item) => {
            const unpriced = item.sizes.some((s) => s.priceCents === null);
            return (
              <li key={item.id} className={`flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ${item.available ? "" : "opacity-60"}`}>
                <button type="button" onClick={() => setEditing(item)} className="flex flex-col gap-1 text-start" data-testid="item-card">
                  <span className="text-lg font-bold">{item.nameAr}</span>
                  <span className="text-sm text-neutral-500" dir="ltr">
                    {item.nameEn}
                  </span>
                  {item.includedAddons.length > 0 && <span className="text-sm text-amber-800">{t("admin.builtIn")}</span>}
                </button>
                <div className="flex flex-wrap gap-2">
                  {item.sizes.map((s) => (
                    <span key={s.id} className={`rounded-lg px-2 py-1 text-sm ${s.priceCents === null ? "bg-red-100 text-red-900" : "bg-neutral-100"}`}>
                      {s.nameAr}: {s.priceCents === null ? t("admin.noPrice") : `${pounds(s.priceCents)} ${t("admin.currency")}`}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  {unpriced && <span className="text-sm text-red-800">{t("admin.hidden")}</span>}
                  <label className="ms-auto flex min-h-12 items-center gap-2">
                    <input type="checkbox" className="size-6" checked={item.available} onChange={() => toggle(item)} />
                    {item.available ? t("admin.available") : t("admin.unavailable")}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {adding && category && (
        <AddItem
          category={category}
          onClose={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false);
            const menu = await api.adminMenu();
            await reload();
            // Straight on to removable ingredients and built-in crust.
            setEditing(menu.categories.flatMap((c) => c.items).find((i) => i.id === id) ?? null);
          }}
        />
      )}
      {editing && (
        <ItemEditor
          item={editing}
          addons={addons}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

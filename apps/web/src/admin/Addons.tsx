import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminAddon, api } from "../api";
import { parsePounds, pounds } from "../format";

export function Addons({ addons, reload }: { addons: AdminAddon[]; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function savePrice(id: string, text: string, old: number | null) {
    const value = parsePounds(text);
    if (value !== null && Number.isNaN(value)) return setError(t("admin.edit.badPrice"));
    setError(null);
    if (value === (old === null ? null : Math.round(old / 100))) return;
    await api.setAddonPrice(id, value);
    await reload();
  }

  const group = (g: AdminAddon["group"], title: string) => (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-bold">{title}</h3>
      {addons
        .filter((a) => a.group === g)
        .map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-sm" data-testid="addon-row">
            <span className="w-40 font-semibold">{a.nameAr}</span>
            {a.prices.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <span>{t(`admin.sizes.${p.sizeKey}`, { defaultValue: p.sizeKey })}</span>
                <input
                  inputMode="numeric"
                  dir="ltr"
                  value={draft[p.id] ?? (p.priceCents === null ? "" : pounds(p.priceCents))}
                  placeholder={t("admin.noPrice")}
                  onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })}
                  onBlur={(e) => savePrice(p.id, e.target.value, p.priceCents)}
                  className="min-h-12 w-28 rounded-xl border border-neutral-300 px-3 text-end"
                />
              </label>
            ))}
            <label className="ms-auto flex min-h-12 items-center gap-2">
              <input
                type="checkbox"
                className="size-6"
                checked={a.available}
                onChange={async () => {
                  await api.updateAddon(a.id, { available: !a.available });
                  await reload();
                }}
              />
              {a.available ? t("admin.available") : t("admin.unavailable")}
            </label>
          </div>
        ))}
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
      {group("crust_stuffing", t("admin.addons.stuffing"))}
      {group("extra", t("admin.addons.extra"))}
    </div>
  );
}

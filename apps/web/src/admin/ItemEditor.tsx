import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminAddon, type AdminItem, api } from "../api";
import { parsePounds, pounds } from "../format";

const toLines = (list: { ar: string; en: string }[]) => list.map((i) => (i.en ? `${i.ar} | ${i.en}` : i.ar)).join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.split("|").map((p) => p.trim()))
    .filter(([ar]) => ar)
    .map(([ar, en]) => ({ ar: ar!, en: en ?? "" }));

export function ItemEditor({ item, addons, onClose, onSaved }: { item: AdminItem; addons: AdminAddon[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    descAr: item.descAr,
    descEn: item.descEn,
    removable: toLines(item.removable),
    includedAddons: item.includedAddons,
  });
  const [prices, setPrices] = useState(Object.fromEntries(item.sizes.map((s) => [s.id, s.priceCents === null ? "" : pounds(s.priceCents)])));
  const [sizeAvailable, setSizeAvailable] = useState(Object.fromEntries(item.sizes.map((s) => [s.id, s.available])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stuffings = addons.filter((a) => a.group === "crust_stuffing");

  async function save() {
    const parsed = Object.fromEntries(Object.entries(prices).map(([id, text]) => [id, parsePounds(text)]));
    if (Object.values(parsed).some((p) => p !== null && Number.isNaN(p))) return setError(t("admin.edit.badPrice"));
    setBusy(true);
    setError(null);
    try {
      await api.updateItem(item.id, {
        nameAr: form.nameAr,
        nameEn: form.nameEn,
        descAr: form.descAr,
        descEn: form.descEn,
        removable: fromLines(form.removable),
        includedAddons: form.includedAddons,
      });
      for (const size of item.sizes) {
        const pricePounds = parsed[size.id] ?? null;
        const oldPounds = size.priceCents === null ? null : Math.round(size.priceCents / 100);
        const patch: { pricePounds?: number | null; available?: boolean } = {};
        if (pricePounds !== oldPounds) patch.pricePounds = pricePounds;
        if (sizeAvailable[size.id] !== size.available) patch.available = sizeAvailable[size.id]!;
        if (Object.keys(patch).length) await api.updateSize(size.id, patch);
      }
      onSaved();
    } catch {
      setError(t("admin.edit.error"));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: "nameAr" | "nameEn" | "descAr" | "descEn", dir: "rtl" | "ltr") => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{t(`admin.edit.${key}`)}</span>
      <input
        dir={dir}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="min-h-12 rounded-xl border border-neutral-300 px-3"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("admin.edit.title")}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="text-xl font-bold">{t("admin.edit.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("nameAr", "rtl")}
          {field("nameEn", "ltr")}
          {field("descAr", "rtl")}
          {field("descEn", "ltr")}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{t("admin.edit.sizes")}</legend>
          {item.sizes.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3">
              <span className="w-20 font-semibold">{s.nameAr}</span>
              <input
                inputMode="numeric"
                dir="ltr"
                aria-label={`${s.nameAr} ${t("admin.currency")}`}
                value={prices[s.id]}
                onChange={(e) => setPrices({ ...prices, [s.id]: e.target.value })}
                placeholder={t("admin.noPrice")}
                className="min-h-12 w-36 rounded-xl border border-neutral-300 px-3 text-end"
              />
              <span>{t("admin.currency")}</span>
              <label className="flex min-h-12 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-6"
                  checked={sizeAvailable[s.id]}
                  onChange={(e) => setSizeAvailable({ ...sizeAvailable, [s.id]: e.target.checked })}
                />
                {t("admin.available")}
              </label>
            </div>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("admin.edit.removable")}</span>
          <span className="text-sm text-neutral-500">{t("admin.edit.removableHint")}</span>
          <textarea
            rows={4}
            value={form.removable}
            onChange={(e) => setForm({ ...form, removable: e.target.value })}
            className="rounded-xl border border-neutral-300 p-3"
          />
        </label>

        {item.halfAndHalf && (
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 font-semibold">{t("admin.edit.builtIn")}</legend>
            {stuffings.map((a) => (
              <label key={a.key} className="flex min-h-12 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-6"
                  checked={form.includedAddons.includes(a.key)}
                  disabled={!form.includedAddons.includes(a.key) && form.includedAddons.length >= 2}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      includedAddons: e.target.checked ? [...form.includedAddons, a.key] : form.includedAddons.filter((k) => k !== a.key),
                    })
                  }
                />
                {a.nameAr}
              </label>
            ))}
          </fieldset>
        )}

        {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={save} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-red-700 font-bold text-white disabled:opacity-50">
            {t("admin.edit.save")}
          </button>
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-neutral-200 font-bold">
            {t("admin.edit.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

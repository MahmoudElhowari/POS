import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminCategory, api } from "../api";
import { parsePounds } from "../format";

const SIZE_SETS = {
  two: [
    { sizeKey: "regular", nameAr: "وسط", nameEn: "Regular" },
    { sizeKey: "large", nameAr: "كبير", nameEn: "Large" },
  ],
  one: [{ sizeKey: "one", nameAr: "حجم واحد", nameEn: "One size" }],
} as const;

/** A new menu item in a category. Removable ingredients and crusts are set in the editor afterwards. */
export function AddItem({ category, onClose, onAdded }: { category: AdminCategory; onClose: () => void; onAdded: (id: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ nameAr: "", nameEn: "", descAr: "", descEn: "" });
  const [sizeSet, setSizeSet] = useState<keyof typeof SIZE_SETS>(category.kind === "pizza" ? "two" : "one");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const sizes = SIZE_SETS[sizeSet].map((s) => ({ ...s, pricePounds: parsePounds(prices[s.sizeKey] ?? "") }));
    if (!form.nameAr.trim()) return setError(t("admin.add.needName"));
    if (sizes.some((s) => Number.isNaN(s.pricePounds))) return setError(t("admin.edit.badPrice"));
    setBusy(true);
    try {
      const { id } = await api.createItem({ categoryId: category.id, ...form, sizes });
      await onAdded(id);
    } catch {
      setError(t("admin.edit.error"));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, dir: "rtl" | "ltr") => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{t(`admin.edit.${key}`)}</span>
      <input dir={dir} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="min-h-12 rounded-xl border border-neutral-300 px-3" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("admin.add.title")}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="text-xl font-bold">{t("admin.add.title", { category: category.nameAr })}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("nameAr", "rtl")}
          {field("nameEn", "ltr")}
          {field("descAr", "rtl")}
          {field("descEn", "ltr")}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{t("admin.edit.sizes")}</legend>
          <div className="flex gap-2">
            {(["two", "one"] as const).map((set) => (
              <button
                key={set}
                type="button"
                aria-pressed={sizeSet === set}
                onClick={() => setSizeSet(set)}
                className={`min-h-12 rounded-xl px-4 font-semibold ${sizeSet === set ? "bg-red-700 text-white" : "bg-neutral-100"}`}
              >
                {t(`admin.add.sizes.${set}`)}
              </button>
            ))}
          </div>
          {SIZE_SETS[sizeSet].map((s) => (
            <div key={s.sizeKey} className="flex items-center gap-3">
              <span className="w-24 font-semibold">{s.nameAr}</span>
              <input
                inputMode="numeric"
                dir="ltr"
                aria-label={`${s.nameAr} ${t("admin.currency")}`}
                value={prices[s.sizeKey] ?? ""}
                onChange={(e) => setPrices({ ...prices, [s.sizeKey]: e.target.value })}
                placeholder={t("admin.noPrice")}
                className="min-h-12 w-36 rounded-xl border border-neutral-300 px-3 text-end"
              />
              <span>{t("admin.currency")}</span>
            </div>
          ))}
          <p className="text-sm text-neutral-500">{t("admin.add.hint")}</p>
        </fieldset>

        {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={() => void save()} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-red-700 font-bold text-white disabled:opacity-50">
            {t("admin.add.save")}
          </button>
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-neutral-200 font-bold">
            {t("admin.edit.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BulkRow } from "../api";
import { pounds } from "../format";

export function BulkPrices({ reload }: { reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const [percent, setPercent] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Basis points: 7.5% = 750.
  const percentBp = Math.round(Number(percent.replace("٫", ".")) * 100);
  const valid = percent.trim() !== "" && Number.isFinite(percentBp) && percentBp > -9_000 && percentBp !== 0;
  const changes = rows?.filter((r) => r.oldCents !== r.newCents) ?? [];

  async function preview() {
    setMessage(null);
    setConfirming(false);
    setRows((await api.bulkPreview(percentBp)).rows);
  }

  async function apply() {
    const { changed } = await api.bulkApply(percentBp);
    setMessage(t("admin.bulk.done", { count: changed }));
    setRows(null);
    setConfirming(false);
    setPercent("");
    await reload();
  }

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">{t("admin.bulk.title")}</h3>
      <p className="text-neutral-600">{t("admin.bulk.hint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("admin.bulk.percent")}</span>
          <input
            inputMode="decimal"
            dir="ltr"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              setRows(null);
            }}
            className="min-h-12 w-32 rounded-xl border border-neutral-300 px-3 text-end"
          />
        </label>
        <button type="button" disabled={!valid} onClick={preview} className="min-h-12 rounded-xl bg-neutral-800 px-6 font-bold text-white disabled:opacity-40">
          {t("admin.bulk.preview")}
        </button>
      </div>

      {message && <p className="rounded-xl bg-emerald-100 p-3 text-emerald-900">{message}</p>}

      {rows && (
        <>
          {changes.length === 0 ? (
            <p>{t("admin.bulk.none")}</p>
          ) : (
            <>
              <div className="max-h-[50vh] overflow-y-auto rounded-2xl bg-white shadow-sm">
                <table className="w-full text-start" data-testid="bulk-preview">
                  <thead className="sticky top-0 bg-neutral-100">
                    <tr>
                      <th className="p-3 text-start">{t("admin.bulk.item")}</th>
                      <th className="p-3 text-start">{t("admin.bulk.size")}</th>
                      <th className="p-3 text-end">{t("admin.bulk.old")}</th>
                      <th className="p-3 text-end">{t("admin.bulk.new")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((r) => (
                      <tr key={r.id} className="border-t border-neutral-100">
                        <td className="p-3">{r.nameAr}</td>
                        <td className="p-3">{r.sizeAr}</td>
                        <td className="p-3 text-end">{pounds(r.oldCents)}</td>
                        <td className="p-3 text-end font-bold">{pounds(r.newCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-100 p-4">
                  <span className="flex-1">{t("admin.bulk.confirm")}</span>
                  <button type="button" onClick={apply} className="min-h-12 rounded-xl bg-red-700 px-6 font-bold text-white">
                    {t("admin.bulk.apply", { count: changes.length })}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="min-h-12 rounded-xl bg-white px-6 font-bold">
                    {t("admin.edit.cancel")}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="min-h-14 rounded-2xl bg-red-700 text-lg font-bold text-white">
                  {t("admin.bulk.apply", { count: changes.length })}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

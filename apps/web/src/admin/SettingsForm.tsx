import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { parsePercentBp, percentText } from "../format";

/** Tax shown on receipts and the receipt's own lines (rule 9: settings, not code). */
export function SettingsForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState<{ rate: string; nameAr: string; nameEn: string; phone: string; address: string; footer: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .settings()
      .then((s) => setForm({ rate: percentText(s.tax.rateBp), nameAr: s.tax.nameAr, nameEn: s.tax.nameEn, ...s.receipt }))
      .catch(() => setNotice({ ok: false, text: t("settings.error") }));
  }, [t]);

  if (!form) return notice ? <p className="rounded-xl bg-red-100 p-3 text-red-900">{notice.text}</p> : null;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setNotice(null);
    setForm({ ...form, [key]: e.target.value });
  };

  async function save() {
    if (!form) return;
    const rateBp = parsePercentBp(form.rate);
    if (rateBp === null || Number.isNaN(rateBp) || rateBp > 5_000 || !form.nameAr.trim()) return setNotice({ ok: false, text: t("settings.bad") });
    setBusy(true);
    try {
      await api.updateSettings({
        tax: { rateBp, nameAr: form.nameAr.trim(), nameEn: form.nameEn.trim() },
        receipt: { phone: form.phone.trim(), address: form.address.trim(), footer: form.footer.trim() },
      });
      setNotice({ ok: true, text: t("settings.saved") });
    } catch {
      setNotice({ ok: false, text: t("settings.error") });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, opts: { ltr?: boolean; hint?: string; numeric?: boolean } = {}) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        value={form[key]}
        onChange={set(key)}
        dir={opts.ltr ? "ltr" : undefined}
        inputMode={opts.numeric ? "decimal" : undefined}
        maxLength={120}
        className="min-h-12 rounded-xl border border-neutral-300 px-3"
      />
      {opts.hint && <span className="text-sm text-neutral-600">{opts.hint}</span>}
    </label>
  );

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{t("settings.tax")}</h3>
        <p className="text-sm text-neutral-600">{t("settings.taxHint")}</p>
        {field("rate", t("settings.taxRate"), { ltr: true, numeric: true })}
        {field("nameAr", t("settings.taxNameAr"))}
        {field("nameEn", t("settings.taxNameEn"), { ltr: true })}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{t("settings.receipt")}</h3>
        {field("phone", t("settings.phone"), { ltr: true })}
        {field("address", t("settings.address"))}
        {field("footer", t("settings.footer"), { hint: t("settings.footerHint") })}
      </div>
      {notice && (
        <p role="status" className={`rounded-xl p-3 font-semibold ${notice.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
          {notice.text}
        </p>
      )}
      <button type="button" disabled={busy} onClick={save} className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50">
        {t("settings.save")}
      </button>
    </section>
  );
}

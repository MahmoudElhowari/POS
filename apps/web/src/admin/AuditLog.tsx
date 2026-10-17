import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AuditEntry, api, type DayCloseSummary } from "../api";
import { pounds } from "../format";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Who did what and when on one business day (rule 11). */
export function AuditLog() {
  const { t } = useTranslation();
  const [days, setDays] = useState<DayCloseSummary[]>([]);
  const [dayId, setDayId] = useState<string>("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    void api
      .closes()
      .then(setDays)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setEntries(null);
    void api
      .audit(dayId || undefined)
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, [dayId]);

  const kind = (k: string) => t(`audit.kinds.${k}`, { defaultValue: k });

  return (
    <section className="flex flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-sm font-semibold">{t("audit.day")}</span>
        <select value={dayId} onChange={(e) => setDayId(e.target.value)} className="min-h-12 rounded-xl border border-neutral-300 bg-white px-3">
          <option value="">{t("audit.current")}</option>
          {days.map((d) => (
            <option key={d.dayId} value={d.dayId}>
              {`${d.date} · ${t("reports.history.z", { number: d.number })}`}
            </option>
          ))}
        </select>
      </label>
      {entries?.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-neutral-500">{t("audit.empty")}</p>}
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white px-4 shadow-sm" data-testid="audit">
        {entries?.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-3 py-2">
            <bdi dir="ltr" className="text-neutral-500">
              {time(e.at)}
            </bdi>
            <span className="font-semibold">{kind(e.kind)}</span>
            {e.orderNumber !== null && <span>{t("reports.order", { n: e.orderNumber })}</span>}
            {e.amountCents !== null && e.kind !== "sent" && <span>{pounds(e.amountCents)}</span>}
            {e.reason && <span>· {t(`reason.reasons.${e.reason}`, { defaultValue: e.reason })}</span>}
            {e.note && <span>· {e.note}</span>}
            {e.staffName && <span className="text-neutral-700">· {e.staffName}</span>}
            {e.approvedByName && <span>· {t("reports.approvedBy", { name: e.approvedByName })}</span>}
            {Object.keys(e.details).length > 0 && (
              <bdi dir="ltr" className="w-full truncate text-xs text-neutral-500">
                {JSON.stringify(e.details)}
              </bdi>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

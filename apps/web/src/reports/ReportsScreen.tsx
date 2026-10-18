import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type DayClose, type DayCloseSummary, type OrderDetail, type XReport } from "../api";
import { parsePounds, pounds } from "../format";
import { PayDialog } from "../today/PayDialog";
import { ReasonDialog } from "../today/ReasonDialog";
import { DifferenceRow, ReportView } from "./ReportView";

type Tab = "x" | "close" | "history";
const TABS: Tab[] = ["x", "close", "history"];

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function errorText(err: unknown, t: (k: string) => string) {
  const code = err instanceof ApiError ? err.body.error : undefined;
  const known = ["unresolved", "already_closed", "bad_count", "not_unpaid", "is_delivery", "not_found"];
  return t(`reports.close.errors.${code && known.includes(code) ? code : "server"}`);
}

/** X report, close of day with the Z, and past Z reports (managers and admins). */
export function ReportsScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("x");
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`min-h-12 rounded-xl px-5 font-bold ${tab === k ? "bg-neutral-900 text-white" : "bg-white"}`}
          >
            {t(`reports.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === "x" && <XTab />}
      {tab === "close" && <CloseTab />}
      {tab === "history" && <HistoryTab />}
    </section>
  );
}

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return (
    <p role="status" className={`rounded-xl p-3 font-semibold ${notice.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
      {notice.text}
    </p>
  );
}

function XTab() {
  const { t } = useTranslation();
  const [x, setX] = useState<XReport | null>(null);
  const [float, setFloat] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const next = await api.xReport();
    setX(next);
    setFloat(String(next.day.floatCents / 100));
  }, []);
  useEffect(() => {
    void load().catch(() => setNotice({ ok: false, text: t("reports.close.errors.server") }));
  }, [load, t]);

  async function saveFloat() {
    const value = parsePounds(float);
    if (value === null || Number.isNaN(value)) return setNotice({ ok: false, text: t("pay.errors.bad_amount") });
    try {
      await api.setFloat(value);
      await load();
      setNotice({ ok: true, text: t("reports.floatSaved") });
    } catch (err) {
      setNotice({ ok: false, text: errorText(err, t) });
    }
  }

  async function print() {
    try {
      await api.printX();
      setNotice({ ok: true, text: t("reports.printed") });
    } catch (err) {
      setNotice({ ok: false, text: errorText(err, t) });
    }
  }

  if (!x) return <Notice notice={notice} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="font-bold">{t("reports.day", { date: x.day.date, time: time(x.day.openedAt) })}</p>
        <label className="ms-auto flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("reports.float")}</span>
          <span className="flex gap-2">
            <input value={float} onChange={(e) => setFloat(e.target.value)} inputMode="numeric" dir="ltr" className="min-h-12 w-36 rounded-xl border border-neutral-300 px-3" />
            <button type="button" onClick={saveFloat} className="min-h-12 rounded-xl bg-red-700 px-4 font-bold text-white">
              {t("reports.saveFloat")}
            </button>
          </span>
        </label>
        <button type="button" onClick={print} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white">
          {t("reports.print")}
        </button>
      </div>
      <Notice notice={notice} />
      <ReportView report={x.report} />
    </div>
  );
}

function CloseTab() {
  const { t } = useTranslation();
  const [x, setX] = useState<XReport | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [other, setOther] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<OrderDetail | null>(null);
  const [closed, setClosed] = useState<DayClose | null>(null);

  const load = useCallback(async () => setX(await api.xReport()), []);
  useEffect(() => {
    void load().catch(() => setNotice({ ok: false, text: t("reports.close.errors.server") }));
  }, [load, t]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
      if (!closed) await load().catch(() => {});
    }
  }

  if (closed) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-2xl bg-emerald-100 p-4 text-emerald-950" data-testid="closed">
          <span className="text-xl font-bold">{t("reports.close.done", { number: closed.number })}</span>
          <span>{t("reports.close.doneHint")}</span>
        </div>
        <ReportView
          report={closed.report}
          count={{ notes: closed.notes, otherCents: closed.otherCents, countedCents: closed.countedCents ?? 0, differenceCents: closed.differenceCents ?? 0 }}
        />
      </div>
    );
  }
  if (!x) return <Notice notice={notice} />;

  const number = (text: string | undefined) => {
    const v = parsePounds(text ?? "");
    return v === null ? 0 : v;
  };
  const notes = x.notesPounds.map((p) => ({ pounds: p, count: number(counts[p]) }));
  const otherPounds = number(other);
  const bad = notes.some((n) => Number.isNaN(n.count)) || Number.isNaN(otherPounds);
  const countedCents = bad ? 0 : (notes.reduce((s, n) => s + n.pounds * n.count, 0) + otherPounds) * 100;
  const unresolved = x.report.unresolved;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{t("reports.close.step1")}</h3>
        <p className="text-sm text-neutral-600">{t("reports.close.step1Hint")}</p>
        {unresolved.length === 0 && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-900">{t("reports.close.allClear")}</p>}
        <ul className="flex flex-col gap-2" data-testid="unresolved">
          {unresolved.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3">
              <span className="flex-1 font-bold">
                {t("reports.order", { n: u.number })} · {u.customerName} · {pounds(u.balanceCents)} {t("admin.currency")}
              </span>
              <button type="button" disabled={busy} onClick={() => setPaying(u.id)} className="min-h-12 rounded-xl bg-red-700 px-4 font-bold text-white">
                {t("reports.close.pay")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(async () => setVoiding(await api.order(u.id)))}
                className="min-h-12 rounded-xl bg-red-100 px-4 font-bold text-red-900"
              >
                {t("reports.close.void")}
              </button>
              <button type="button" disabled={busy} onClick={() => void act(() => api.leaveUnpaid(u.id, ""))} className="min-h-12 rounded-xl bg-neutral-200 px-4 font-bold">
                {t("reports.close.leave")}
              </button>
            </li>
          ))}
        </ul>
        {x.report.carried.length > 0 && (
          <p className="text-sm text-neutral-700">
            {t("reports.carried")}: {x.report.carried.map((c) => `#${c.number}`).join("، ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{t("reports.close.step2")}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {x.notesPounds.map((p) => (
            <label key={p} className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("reports.close.count", { pounds: pounds(p * 100) })}</span>
              <input
                value={counts[p] ?? ""}
                onChange={(e) => setCounts({ ...counts, [p]: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                className="min-h-12 rounded-xl border border-neutral-300 px-3 text-lg"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("reports.close.other")}</span>
            <input value={other} onChange={(e) => setOther(e.target.value)} inputMode="numeric" dir="ltr" className="min-h-12 rounded-xl border border-neutral-300 px-3 text-lg" />
          </label>
        </div>
        <div className="flex flex-col border-t border-neutral-200 pt-2">
          <div className="flex justify-between py-1">
            <span>{t("reports.expected")}</span>
            <bdi dir="ltr">
              {pounds(x.report.expectedCashCents)} {t("admin.currency")}
            </bdi>
          </div>
          <div className="flex justify-between py-1 text-lg font-bold" data-testid="counted">
            <span>{t("reports.counted")}</span>
            <bdi dir="ltr">
              {pounds(countedCents)} {t("admin.currency")}
            </bdi>
          </div>
          <DifferenceRow cents={countedCents - x.report.expectedCashCents} />
        </div>
        <Notice notice={notice} />
        <p className="text-sm text-neutral-600">{t("reports.close.confirmHint")}</p>
        <button
          type="button"
          disabled={busy || bad || unresolved.length > 0}
          onClick={() =>
            void act(async () => {
              setClosed(await api.closeDay({ dayId: x.day.id, notes, otherPounds }));
            })
          }
          className="min-h-16 rounded-xl bg-red-700 text-xl font-bold text-white disabled:opacity-50"
        >
          {t("reports.close.confirm")}
        </button>
      </section>

      {paying && (
        <PayDialog
          orderId={paying}
          onClose={() => {
            setPaying(null);
            void load();
          }}
        />
      )}
      {voiding && (
        <ReasonDialog
          order={voiding}
          mode="void"
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function HistoryTab() {
  const { t } = useTranslation();
  const [list, setList] = useState<DayCloseSummary[] | null>(null);
  const [open, setOpen] = useState<DayClose | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void api
      .closes()
      .then(setList)
      .catch(() => setNotice({ ok: false, text: t("reports.close.errors.server") }));
  }, [t]);

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="text-xl font-bold">
            {t("reports.history.z", { number: open.number })} · <bdi dir="ltr">{open.date}</bdi>
          </h3>
          <span className="text-neutral-600">{open.kind === "automatic" ? t("reports.history.automatic") : t("reports.history.by", { name: open.closedBy })}</span>
          <button
            type="button"
            onClick={() =>
              void api
                .reprintZ(open.id)
                .then(() => setNotice({ ok: true, text: t("reports.printed") }))
                .catch(() => setNotice({ ok: false, text: t("reports.close.errors.server") }))
            }
            className="ms-auto min-h-12 rounded-xl bg-red-700 px-4 font-bold text-white"
          >
            {t("reports.history.reprint")}
          </button>
          <button type="button" onClick={() => setOpen(null)} className="min-h-12 rounded-xl bg-neutral-200 px-4 font-bold">
            {t("reports.history.back")}
          </button>
        </div>
        <Notice notice={notice} />
        <ReportView
          report={open.report}
          count={
            open.countedCents === null
              ? null
              : { notes: open.notes, otherCents: open.otherCents, countedCents: open.countedCents, differenceCents: open.differenceCents ?? 0 }
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Notice notice={notice} />
      {list?.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-neutral-500">{t("reports.history.empty")}</p>}
      <ul className="flex flex-col gap-2" data-testid="z-history">
        {list?.map((z) => (
          <li key={z.id}>
            <button
              type="button"
              onClick={() => void api.dayClose(z.id).then(setOpen)}
              className="flex min-h-16 w-full flex-wrap items-center gap-3 rounded-2xl bg-white p-3 text-start shadow-sm"
            >
              <span className="text-xl font-bold">{t("reports.history.z", { number: z.number })}</span>
              <bdi dir="ltr" className="text-neutral-600">
                {z.date}
              </bdi>
              <span className="text-neutral-600">{z.kind === "automatic" ? t("reports.history.automatic") : t("reports.history.by", { name: z.closedBy })}</span>
              <span className="ms-auto font-semibold">
                {pounds(z.netCents)} {t("admin.currency")}
              </span>
              {z.differenceCents !== null && (
                <span className={`rounded-lg px-2 py-1 text-sm font-bold ${z.differenceCents === 0 ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
                  <bdi dir="ltr">{z.differenceCents > 0 ? `+${pounds(z.differenceCents)}` : z.differenceCents < 0 ? `-${pounds(-z.differenceCents)}` : "0"}</bdi>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

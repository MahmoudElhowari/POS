import { type Dashboard, type DashboardView, type Headline, PERIODS, type PeriodKind, periodRange, qtyText, weekdayOf } from "@pos/shared";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { percentText, pounds } from "../format";
import { halvesText } from "./ReportView";

type Pick = { kind: PeriodKind | "custom"; from: string; to: string };

/** Change from the previous period in basis points, rounded half away from zero; null when there was nothing before. */
function changeBp(now: number, before: number) {
  if (before <= 0) return null;
  const diff = now - before;
  const bp = Math.floor((2 * Math.abs(diff) * 10_000 + before) / (2 * before));
  return diff < 0 ? -bp : bp;
}

const HEADLINE: { key: keyof Headline; money: boolean; goodWhenUp: boolean }[] = [
  { key: "salesCents", money: true, goodWhenUp: true },
  { key: "orders", money: false, goodWhenUp: true },
  { key: "averageCents", money: true, goodWhenUp: true },
  { key: "discountCents", money: true, goodWhenUp: false },
  { key: "refundCents", money: true, goodWhenUp: false },
  { key: "voids", money: false, goodWhenUp: false },
];

/** Sales over a period: totals, hours, days, items and stock bought (Milestone 10). */
export function DashboardTab() {
  const { t } = useTranslation();
  const [view, setView] = useState<DashboardView | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [error, setError] = useState<string | null>(null);

  // Only the latest period asked for is shown, even if an earlier answer arrives after it.
  const latest = useRef(0);
  const load = useCallback(
    async (next: Pick | null) => {
      setError(null);
      const asked = ++latest.current;
      try {
        const got = await api.dashboard(next ?? undefined);
        if (asked !== latest.current) return;
        setView(got);
        setPick(next ?? { kind: "this_week", from: got.current.from, to: got.current.to });
      } catch {
        if (asked === latest.current) setError(t("dashboard.errors.server"));
      }
    },
    [t],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function choose(kind: PeriodKind) {
    if (view) void load({ kind, ...periodRange(kind, view.today) });
  }

  function showCustom() {
    if (!custom.from || !custom.to || custom.from > custom.to) return setError(t("dashboard.errors.badPeriod"));
    void load({ kind: "custom", ...custom });
  }

  async function download(kind: "days" | "items") {
    if (!pick) return;
    try {
      const blob = await api.dashboardCsv(pick.from, pick.to, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `romantica-${kind}-${pick.from}-${pick.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("dashboard.errors.server"));
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm">
        {PERIODS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => choose(k)}
            aria-pressed={pick?.kind === k}
            className={`min-h-12 rounded-xl px-4 font-bold ${pick?.kind === k ? "bg-red-700 text-white" : "bg-neutral-100"}`}
          >
            {t(`dashboard.periods.${k}`)}
          </button>
        ))}
        <label className="ms-auto flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("dashboard.from")}</span>
          <input
            type="date"
            value={custom.from}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            className="min-h-12 rounded-xl border border-neutral-300 px-3"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("dashboard.to")}</span>
          <input
            type="date"
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            className="min-h-12 rounded-xl border border-neutral-300 px-3"
          />
        </label>
        <button type="button" onClick={showCustom} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white">
          {t("dashboard.show")}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-100 p-3 font-semibold text-red-900">
          {error}
        </p>
      )}

      {view && pick && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold" data-testid="period">
              {pick.from === pick.to ? (
                <bdi dir="ltr">{pick.from}</bdi>
              ) : (
                <>
                  {t("dashboard.from")} <bdi dir="ltr">{pick.from}</bdi> {t("dashboard.to")} <bdi dir="ltr">{pick.to}</bdi>
                </>
              )}
            </h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => void download("days")} className="min-h-12 rounded-xl bg-red-700 px-4 font-bold text-white">
                {t("dashboard.exportDays")}
              </button>
              <button type="button" onClick={() => void download("items")} className="min-h-12 rounded-xl bg-red-700 px-4 font-bold text-white">
                {t("dashboard.exportItems")}
              </button>
            </div>
          </div>
          <Body view={view} />
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Money({ cents }: { cents: number }) {
  const { t } = useTranslation();
  return <span>{t("dashboard.money", { amount: pounds(cents) })}</span>;
}

function Body({ view }: { view: DashboardView }) {
  const { t } = useTranslation();
  const d = view.current;
  const [byQty, setByQty] = useState(false);
  const items = byQty ? [...d.items].sort((a, b) => b.halves - a.halves || b.salesCents - a.salesCents) : d.items;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="headline">
        {HEADLINE.map(({ key, money, goodWhenUp }) => {
          const change = changeBp(d.headline[key], view.previous[key]);
          const good = change !== null && change !== 0 && change > 0 === goodWhenUp;
          return (
            <div key={key} className="flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-sm" data-testid={`headline-${key}`}>
              <span className="text-sm text-neutral-600">{t(`dashboard.headline.${key}`)}</span>
              <span className="text-2xl font-bold">{money ? <Money cents={d.headline[key]} /> : d.headline[key]}</span>
              <span className={`text-sm font-semibold ${change === null || change === 0 ? "text-neutral-500" : good ? "text-emerald-700" : "text-red-700"}`}>
                {change === null
                  ? t("dashboard.noPrevious")
                  : t("dashboard.change", { sign: change > 0 ? "+" : change < 0 ? "−" : "", percent: percentText(Math.abs(change)) })}
              </span>
            </div>
          );
        })}
      </div>

      <Card title={t("dashboard.hours")}>
        <HourChart d={d} startHour={view.dayStartHour} />
      </Card>

      {d.days.length > 1 && (
        <Card title={t("dashboard.days")}>
          {d.headline.orders === 0 ? (
            <p className="text-neutral-600">{t("dashboard.none")}</p>
          ) : (
            <Bars
              testId="day-bar"
              bars={d.days.map((x) => ({
                key: x.date,
                // A month of bars only has room for the day of the month.
                label: d.days.length > 10 ? String(Number(x.date.slice(8))) : `${t(`dashboard.weekdaysShort.${weekdayOf(x.date)}`)} ${Number(x.date.slice(8))}`,
                value: x.salesCents,
                detail: t("dashboard.barDetail", { label: x.date, orders: x.orders, amount: pounds(x.salesCents) }),
              }))}
            />
          )}
        </Card>
      )}

      {d.weekdays.length > 0 && (
        <Card title={t("dashboard.weekdays")}>
          <Table
            head={[t("dashboard.weekday"), t("dashboard.openDays"), t("dashboard.sales"), t("dashboard.average")]}
            rows={d.weekdays.map((w) => [
              t(`dashboard.weekdayNames.${w.weekday}`),
              w.openDays,
              <Money key="s" cents={w.salesCents} />,
              <Money key="a" cents={w.averageCents} />,
            ])}
          />
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t("dashboard.byType")}>
          <Table
            head={[t("dashboard.type"), t("dashboard.orders"), t("dashboard.sales")]}
            rows={d.byType.map((x) => [t(`order.types.${x.type}`), x.count, <Money key="s" cents={x.salesCents} />])}
          />
        </Card>
        <Card title={t("dashboard.byMethod")}>
          {d.byMethod.length ? (
            <Table
              head={[t("dashboard.method"), t("dashboard.payments"), t("dashboard.amount")]}
              rows={d.byMethod.map((x) => [x.walletName ?? t("dashboard.cash"), x.count, <Money key="a" cents={x.amountCents} />])}
            />
          ) : (
            <p className="text-neutral-600">{t("dashboard.none")}</p>
          )}
        </Card>
      </div>

      <Card title={t("dashboard.items")}>
        <div className="flex gap-2">
          {[false, true].map((q) => (
            <button
              key={String(q)}
              type="button"
              onClick={() => setByQty(q)}
              aria-pressed={byQty === q}
              className={`min-h-12 rounded-xl px-4 font-bold ${byQty === q ? "bg-red-700 text-white" : "bg-neutral-100"}`}
            >
              {t(q ? "dashboard.byQty" : "dashboard.bySales")}
            </button>
          ))}
        </div>
        {d.categories.length > 0 && (
          <Table
            testId="categories"
            head={[t("dashboard.category"), t("dashboard.qty"), t("dashboard.sales"), t("dashboard.share")]}
            rows={d.categories.map((c) => [
              c.nameAr || t("dashboard.otherCategory"),
              <bdi key="q" dir="ltr">
                {halvesText(c.halves)}
              </bdi>,
              <Money key="s" cents={c.salesCents} />,
              `${percentText(c.shareBp)}%`,
            ])}
          />
        )}
        {items.length ? (
          <Table
            testId="items"
            head={[t("dashboard.item"), t("dashboard.qty"), t("dashboard.sales"), t("dashboard.share")]}
            rows={items.map((i) => [
              `${i.nameAr}${i.sizeAr ? ` · ${i.sizeAr}` : ""}`,
              <bdi key="q" dir="ltr">
                {halvesText(i.halves)}
              </bdi>,
              <Money key="s" cents={i.salesCents} />,
              `${percentText(i.shareBp)}%`,
            ])}
          />
        ) : (
          <p className="text-neutral-600">{t("dashboard.none")}</p>
        )}
        <p className="text-sm text-neutral-600">{t("dashboard.itemsNote")}</p>
      </Card>

      <Card title={t("dashboard.stock")}>
        {d.stock.items.length ? (
          <>
            <p className="text-lg font-bold" data-testid="stock-total">
              {t("dashboard.stockTotal")} <Money cents={d.stock.totalCents} />
            </p>
            <Table
              testId="stock-bought"
              head={[t("dashboard.stockItem"), t("dashboard.qty"), t("dashboard.deliveries"), t("dashboard.cost")]}
              rows={d.stock.items.map((s) => [
                s.nameAr,
                <span key="q">
                  <bdi dir="ltr">{qtyText(s.qty, s.unit)}</bdi> {t(`inventory.units.${s.unit}`)}
                </span>,
                s.deliveries,
                s.costCents ? <Money key="c" cents={s.costCents} /> : "—",
              ])}
            />
          </>
        ) : (
          <p className="text-neutral-600">{t("dashboard.noStock")}</p>
        )}
      </Card>
    </>
  );
}

/** Opening hours only: from the first hour with orders to the last, counted from the start of the business day. */
function HourChart({ d, startHour }: { d: Dashboard; startHour: number }) {
  const { t } = useTranslation();
  const ordered = Array.from({ length: 24 }, (_, i) => d.hours[(startHour + i) % 24]!);
  const first = ordered.findIndex((h) => h.orders > 0);
  if (first < 0) return <p className="text-neutral-600">{t("dashboard.none")}</p>;
  const last = ordered.findLastIndex((h) => h.orders > 0);
  const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <Bars
      testId="hour-bar"
      bars={ordered
        .slice(first, last + 1)
        .map((h) => ({
          key: String(h.hour),
          label: String(h.hour),
          value: h.salesCents,
          detail: t("dashboard.barDetail", { label: hour(h.hour), orders: h.orders, amount: pounds(h.salesCents) }),
        }))}
    />
  );
}

/** A bar chart from plain boxes, so it follows the page's right-to-left order and needs no chart library. */
function Bars({ bars, testId }: { bars: { key: string; label: string; value: number; detail: string }[]; testId: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex h-56 items-end gap-1" role="list">
      {bars.map((b) => (
        <div
          key={b.key}
          role="listitem"
          aria-label={b.detail}
          title={b.detail}
          data-testid={testId}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <div className="w-full rounded-t-md bg-red-700" style={{ height: `${Math.round((b.value / max) * 85)}%`, minHeight: b.value > 0 ? "2px" : 0 }} />
          <span className="w-full truncate text-center text-xs text-neutral-600">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows, testId }: { head: string[]; rows: ReactNode[][]; testId?: string }) {
  return (
    <table className="w-full text-start" data-testid={testId}>
      <thead className="border-b border-neutral-200 text-sm text-neutral-600">
        <tr>
          {head.map((h) => (
            <th key={h} className="p-2 text-start">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-neutral-100">
            {r.map((c, j) => (
              <td key={j} className={`p-2 ${j === 0 ? "font-semibold" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import type { OrderStatus } from "@pos/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type OrderDetail, type OrderSummary } from "../api";
import { pounds } from "../format";
import { useLiveOrders } from "../useLiveOrders";
import { moneyError, StatusBadge, TotalsBox } from "./money";
import { PayDialog } from "./PayDialog";
import { ReasonDialog } from "./ReasonDialog";

type Filter = "all" | "open" | "paid" | "cancelled";
const FILTERS: Filter[] = ["all", "open", "paid", "cancelled"];
const inFilter: Record<Filter, (s: OrderStatus) => boolean> = {
  all: () => true,
  open: (s) => s === "unpaid" || s === "part_paid",
  paid: (s) => s === "paid",
  cancelled: (s) => s === "voided" || s === "refunded",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The day's sent orders: who has paid, and pay, reprint, void or refund. */
export function TodayOrders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => setOrders(await api.todayOrders().catch(() => [])), []);
  useLiveOrders(load, 10_000);

  const shown = orders?.filter((o) => inFilter[filter](o.totals.status)) ?? [];
  const count = (f: Filter) => orders?.filter((o) => inFilter[f](o.totals.status)).length ?? 0;

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_30rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-12 rounded-xl px-4 font-bold ${filter === f ? "bg-red-700 text-white" : "bg-white shadow-sm"}`}
            >
              {t(`today.filters.${f}`)} ({count(f)})
            </button>
          ))}
        </div>
        {orders && shown.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-neutral-500">{t("today.empty")}</p>}
        <ul className="flex flex-col gap-2" data-testid="today-orders">
          {shown.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => setSelected(o.id)}
                className={`flex min-h-16 w-full items-center gap-3 rounded-2xl p-3 text-start shadow-sm ${selected === o.id ? "bg-amber-50 ring-2 ring-red-700" : "bg-white"}`}
                data-testid="today-order"
              >
                <span className="min-w-12 text-2xl font-bold">{o.number}</span>
                <span className="flex flex-1 flex-col">
                  <span className="font-bold">{o.customerName}</span>
                  <span className="text-sm text-neutral-600">
                    {t(`order.types.${o.type}`)}
                    {o.tableNo ? ` · ${t("order.table", { n: o.tableNo })}` : ""} · <bdi dir="ltr">{time(o.sentAt)}</bdi>
                    {o.carried && <span className="ms-2 rounded bg-amber-100 px-1 font-semibold text-amber-900">{t("today.carried")}</span>}
                  </span>
                </span>
                <span className="font-semibold">
                  {pounds(o.totals.totalCents)} {t("admin.currency")}
                </span>
                <StatusBadge status={o.totals.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <aside className="rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
        {selected ? <OrderPanel key={selected} id={selected} onChanged={load} onClose={() => setSelected(null)} /> : <p className="py-6 text-center text-neutral-500">{t("today.pick")}</p>}
      </aside>
    </section>
  );
}

function OrderPanel({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [dialog, setDialog] = useState<"pay" | "void" | "refund" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await api.order(id));
    } catch (err) {
      setNotice({ ok: false, text: moneyError(err, t) });
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged();
  };

  async function reprint(which: "kitchen" | "receipt") {
    try {
      await api.reprint(id, which);
      setNotice({ ok: true, text: t("today.reprinted") });
    } catch (err) {
      setNotice({ ok: false, text: moneyError(err, t) });
    }
  }

  if (!order) return notice ? <p className="rounded-xl bg-red-100 p-3 text-red-900">{notice.text}</p> : null;
  const { totals } = order;
  const open = totals.status === "unpaid" || totals.status === "part_paid";

  return (
    <div className="flex flex-col gap-4" data-testid="order-panel">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold">{t("today.number", { number: order.number })}</h2>
        <StatusBadge status={totals.status} />
        <button type="button" onClick={onClose} className="ms-auto min-h-12 rounded-xl bg-neutral-100 px-4 font-semibold">
          {t("today.close")}
        </button>
      </div>
      <div className="flex flex-col text-neutral-700">
        <span className="font-bold">
          {order.customerName} · {t(`order.types.${order.type}`)}
          {order.tableNo ? ` · ${t("order.table", { n: order.tableNo })}` : ""}
        </span>
        {order.customerPhone && (
          <span>
            {t("today.phone")}: <bdi dir="ltr">{order.customerPhone}</bdi>
          </span>
        )}
        {order.deliveryArea && <span>{`${t("today.area")}: ${order.deliveryArea}`}</span>}
        {order.deliveryDirections && <span>{`${t("today.directions")}: ${order.deliveryDirections}`}</span>}
        {order.note && <span>{`${t("today.note")}: ${order.note}`}</span>}
      </div>

      <ol className="flex flex-col divide-y divide-neutral-200">
        {order.lines.map((l) => (
          <li key={l.id} className="flex gap-2 py-2">
            <span className="font-bold">{l.qty}×</span>
            <span className="flex flex-1 flex-col">
              <span className="font-bold">
                {l.otherHalfNameAr ? t("order.halfName", { a: l.nameAr, b: l.otherHalfNameAr }) : l.nameAr}
                {l.sizeKey !== "one" ? ` · ${l.sizeNameAr}` : ""}
              </span>
              {l.addons.length > 0 && <span className="text-sm text-neutral-600">+ {l.addons.map((a) => a.nameAr).join("، ")}</span>}
              {l.removals.length > 0 && <span className="text-sm text-red-800">{l.removals.map((r) => t("order.withoutName", { name: r.ar })).join("، ")}</span>}
              {l.note && <span className="text-sm text-neutral-600">{l.note}</span>}
            </span>
            <span className="font-semibold">{pounds(l.totalCents)}</span>
          </li>
        ))}
      </ol>

      <TotalsBox totals={totals} taxRateBp={order.taxRateBp} taxName={order.taxNameAr} />

      {notice && (
        <p role="status" className={`rounded-xl p-3 font-semibold ${notice.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {open && (
          <button type="button" onClick={() => setDialog("pay")} className="col-span-2 min-h-16 rounded-xl bg-red-700 text-xl font-bold text-white">
            {t("today.pay")}
          </button>
        )}
        <button type="button" onClick={() => void reprint("kitchen")} className="min-h-12 rounded-xl bg-neutral-100 px-2 font-semibold">
          {t("today.reprintKitchen")}
        </button>
        <button type="button" onClick={() => void reprint("receipt")} className="min-h-12 rounded-xl bg-neutral-100 px-2 font-semibold">
          {t("today.reprintReceipt")}
        </button>
        {totals.status === "unpaid" && (
          <button type="button" onClick={() => setDialog("void")} className="col-span-2 min-h-12 rounded-xl bg-red-100 font-bold text-red-900">
            {t("today.void")}
          </button>
        )}
        {totals.paidCents > 0 && totals.status !== "refunded" && (
          <button type="button" onClick={() => setDialog("refund")} className="col-span-2 min-h-12 rounded-xl bg-red-100 font-bold text-red-900">
            {t("today.refund")}
          </button>
        )}
      </div>

      <section className="flex flex-col gap-1">
        <h3 className="font-bold">{t("today.history")}</h3>
        <ul className="flex flex-col gap-1 text-sm text-neutral-700" data-testid="history">
          {order.history.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-x-2">
              <bdi dir="ltr" className="text-neutral-500">
                {time(h.createdAt)}
              </bdi>
              <span className="font-semibold">{t(`today.kinds.${h.kind}`)}</span>
              {h.amountCents !== null && <span>{pounds(h.amountCents)}</span>}
              {h.reason && <span>· {t(`reason.reasons.${h.reason}`)}</span>}
              {h.note && <span>· {h.note}</span>}
              <span>· {h.staffName}</span>
              {h.approvedByName && <span>· {t("today.approvedBy", { name: h.approvedByName })}</span>}
            </li>
          ))}
        </ul>
      </section>

      {dialog === "pay" && (
        <PayDialog
          orderId={order.id}
          onChanged={changed}
          onClose={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {(dialog === "void" || dialog === "refund") && (
        <ReasonDialog
          order={order}
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

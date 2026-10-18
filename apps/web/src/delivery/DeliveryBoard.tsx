import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type BoardOrder, type DeliveryBoard as Board } from "../api";
import { parsePounds, pounds } from "../format";
import { StatusBadge } from "../today/money";
import { useLiveOrders } from "../useLiveOrders";

const KNOWN = ["not_found", "not_delivery", "voided", "not_waiting", "not_out", "no_driver", "duplicate", "bad_amount", "paid"];

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

/**
 * Today's delivery orders (docs/milestones/m7-delivery-board.md): pick a
 * driver for waiting orders, then mark each one delivered with the cash the
 * driver brings back. The driver keeps the delivery fee.
 */
export function DeliveryBoard() {
  const { t } = useTranslation();
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<BoardOrder | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const next = await api.deliveryBoard();
      setBoard(next);
      setNow(Date.now());
      // Drop orders from the selection that someone else has sent out.
      setSelected((s) => s.filter((id) => next.orders.some((o) => o.id === id && o.delivery.state === "waiting")));
    } catch {
      setNotice({ ok: false, text: t("delivery.errors.server") });
    }
  }, [t]);
  useLiveOrders(load);

  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.body.error : undefined;
    setNotice({ ok: false, text: t(code && KNOWN.includes(code) ? `delivery.errors.${code}` : "delivery.errors.server") });
  };

  async function sendOut() {
    if (!driverId || selected.length === 0) return;
    setNotice(null);
    try {
      await api.sendOut(driverId, selected);
      const name = board?.drivers.find((d) => d.id === driverId)?.name ?? "";
      setNotice({ ok: true, text: t("delivery.sentOut", { count: selected.length, name }) });
      setSelected([]);
      setDriverId(null);
    } catch (err) {
      fail(err);
    }
    await load();
  }

  async function returned(o: BoardOrder) {
    setNotice(null);
    try {
      await api.returned(o.id, "");
      setNotice({ ok: true, text: t("delivery.returnedDone", { n: o.number }) });
    } catch (err) {
      fail(err);
    }
    await load();
  }

  if (!board) return null;
  const column = (state: BoardOrder["delivery"]["state"]) => board.orders.filter((o) => o.delivery.state === state);
  const waiting = column("waiting");
  const out = column("out");
  const delivered = column("delivered");
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const header = (o: BoardOrder) => (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold">{o.number}</span>
      <span className="flex-1 font-bold">{o.customerName}</span>
      {o.carried && <span className="rounded bg-amber-100 px-1 text-sm font-semibold text-amber-900">{t("today.carried")}</span>}
      <StatusBadge status={o.totals.status} />
    </div>
  );
  const address = (o: BoardOrder) => (
    <div className="flex flex-col text-sm text-neutral-700">
      {o.phone && (
        <span>
          {t("today.phone")}: <bdi dir="ltr">{o.phone}</bdi>
        </span>
      )}
      {(o.area || o.directions) && <span>{[o.area, o.directions].filter(Boolean).join(" · ")}</span>}
    </div>
  );
  const collect = (o: BoardOrder) => (
    <div className="flex justify-between gap-2 font-semibold">
      <span>{o.totals.balanceCents > 0 ? t("delivery.collect") : t("delivery.nothingToCollect")}</span>
      {o.totals.balanceCents > 0 && (
        <span>
          {pounds(o.totals.balanceCents)} {t("admin.currency")}
        </span>
      )}
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      {notice && (
        <p role="status" className={`rounded-xl p-3 font-semibold ${notice.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3" data-testid="waiting">
          <h2 className="text-xl font-bold">
            {t("delivery.waiting")} ({waiting.length})
          </h2>
          {waiting.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-neutral-500">{t("delivery.noneWaiting")}</p>}
          {waiting.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected.includes(o.id)}
              onClick={() => toggle(o.id)}
              className={`flex flex-col gap-2 rounded-2xl p-4 text-start shadow-sm ${selected.includes(o.id) ? "bg-amber-50 ring-4 ring-red-700" : "bg-white"}`}
              data-testid="board-order"
            >
              {header(o)}
              {address(o)}
              <span className="text-sm text-neutral-600">
                {t("delivery.sentAt")} <bdi dir="ltr">{time(o.sentAt)}</bdi> · {t("delivery.minutes", { n: minutesSince(o.sentAt, now) })}
              </span>
              {collect(o)}
            </button>
          ))}

          {waiting.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="send-out">
              <span className="font-bold">{t("delivery.pickDriver")}</span>
              {board.drivers.length === 0 && <p className="text-neutral-600">{t("delivery.noDrivers")}</p>}
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("delivery.pickDriver")}>
                {board.drivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={driverId === d.id}
                    onClick={() => setDriverId(d.id)}
                    className={`min-h-12 rounded-xl px-4 font-bold ${driverId === d.id ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!driverId || selected.length === 0}
                onClick={() => void sendOut()}
                className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50"
              >
                {t("delivery.sendOut", { count: selected.length })}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3" data-testid="out">
          <h2 className="text-xl font-bold">
            {t("delivery.out")} ({out.length})
          </h2>
          {out.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-neutral-500">{t("delivery.noneOut")}</p>}
          {out.map((o) => (
            <div key={o.id} className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="board-order">
              {header(o)}
              <span className="font-semibold">
                {o.delivery.driverName} · {t("delivery.outFor", { n: minutesSince(o.delivery.outAt ?? o.sentAt, now) })}
              </span>
              {address(o)}
              {collect(o)}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setDelivering(o)} className="min-h-12 rounded-xl bg-red-700 font-bold text-white">
                  {t("delivery.delivered")}
                </button>
                <button type="button" onClick={() => void returned(o)} className="min-h-12 rounded-xl bg-neutral-100 font-semibold">
                  {t("delivery.returned")}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3" data-testid="delivered">
          <h2 className="text-xl font-bold">
            {t("delivery.done")} ({delivered.length})
          </h2>
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white px-4 shadow-sm">
            {delivered.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-bold">{o.number}</span>
                <span className="flex-1">{o.customerName}</span>
                <span className="text-sm text-neutral-600">
                  {o.delivery.driverName} · <bdi dir="ltr">{time(o.delivery.deliveredAt ?? o.sentAt)}</bdi>
                </span>
                <StatusBadge status={o.totals.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <DriverSummary board={board} />

      {delivering && (
        <DeliveredDialog
          order={delivering}
          onClose={() => setDelivering(null)}
          onDone={(text) => {
            setDelivering(null);
            setNotice({ ok: true, text });
            void load();
          }}
        />
      )}
    </section>
  );
}

/** What each driver took out today and the cash they hand in. */
function DriverSummary({ board }: { board: Board }) {
  const { t } = useTranslation();
  const names = new Set([...board.summary.map((d) => d.name), ...board.orders.filter((o) => o.delivery.state === "out").map((o) => o.delivery.driverName ?? "")]);
  if (names.size === 0) return null;
  const stillOut = (name: string) => board.orders.filter((o) => o.delivery.state === "out" && o.delivery.driverName === name);
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="driver-summary">
      <h2 className="text-xl font-bold">{t("delivery.summary")}</h2>
      <table className="w-full text-start">
        <thead className="text-sm text-neutral-600">
          <tr>
            <th className="py-1 text-start">{t("delivery.driver")}</th>
            <th className="py-1 text-start">{t("delivery.ordersDelivered")}</th>
            <th className="py-1 text-start">{t("delivery.collected")}</th>
            <th className="py-1 text-start">{t("delivery.fees")}</th>
            <th className="py-1 text-start">{t("delivery.handIn")}</th>
            <th className="py-1 text-start">{t("delivery.stillOut")}</th>
          </tr>
        </thead>
        <tbody>
          {[...names].map((name) => {
            const row = board.summary.find((d) => d.name === name);
            const out = stillOut(name);
            return (
              <tr key={name} className="border-t border-neutral-200">
                <td className="py-2 font-bold">{name}</td>
                <td className="py-2">{row?.orders ?? 0}</td>
                <td className="py-2">{pounds(row?.collectedCents ?? 0)}</td>
                <td className="py-2">{pounds(row?.feesCents ?? 0)}</td>
                <td className="py-2 text-lg font-bold">
                  <bdi dir="ltr">{(row?.handInCents ?? 0) < 0 ? `-${pounds(-(row?.handInCents ?? 0))}` : pounds(row?.handInCents ?? 0)}</bdi>
                </td>
                <td className={`py-2 ${out.length ? "font-bold text-red-700" : ""}`}>{out.length ? out.map((o) => `#${o.number}`).join("، ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The driver is back: the order was delivered, with the cash they collected. */
function DeliveredDialog({ order, onClose, onDone }: { order: BoardOrder; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useTranslation();
  const due = Math.ceil(order.totals.balanceCents / 100);
  const [cash, setCash] = useState(due > 0 ? String(due) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parsePounds(cash);

  async function done(withCash: boolean) {
    if (withCash && (amount === null || Number.isNaN(amount) || amount <= 0)) return setError(t("delivery.errors.bad_amount"));
    setBusy(true);
    setError(null);
    try {
      const { changeCents } = await api.delivered(order.id, withCash ? amount : null);
      onDone(changeCents > 0 ? t("delivery.deliveredChange", { n: order.number, change: pounds(changeCents) }) : t("delivery.deliveredDone", { n: order.number }));
    } catch (err) {
      const code = err instanceof ApiError ? err.body.error : undefined;
      setError(t(code && KNOWN.includes(code) ? `delivery.errors.${code}` : "delivery.errors.server"));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("delivery.delivered")}>
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-2xl font-bold">{t("delivery.deliveredTitle", { n: order.number })}</h2>
        <p className="font-semibold">
          {order.customerName} · {order.delivery.driverName}
        </p>
        <div className="flex flex-col gap-1 rounded-xl bg-neutral-50 p-3">
          <div className="flex justify-between">
            <span>{t("delivery.collect")}</span>
            <span className="text-xl font-bold" data-testid="due">
              {pounds(order.totals.balanceCents)} {t("admin.currency")}
            </span>
          </div>
          {order.totals.deliveryFeeCents > 0 && (
            <div className="flex justify-between text-neutral-700">
              <span>{t("delivery.driverKeeps")}</span>
              <span>
                {pounds(order.totals.deliveryFeeCents)} {t("admin.currency")}
              </span>
            </div>
          )}
        </div>
        {due > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("delivery.cashFromDriver")}</span>
            <input
              inputMode="numeric"
              dir="ltr"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              className="min-h-14 rounded-xl border border-neutral-300 px-4 text-2xl font-bold"
            />
          </label>
        )}
        {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
        {due > 0 ? (
          <>
            <button type="button" disabled={busy} onClick={() => void done(true)} className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50">
              {t("delivery.deliveredPaid")}
            </button>
            <button type="button" disabled={busy} onClick={() => void done(false)} className="min-h-12 rounded-xl bg-neutral-100 font-semibold disabled:opacity-50">
              {t("delivery.deliveredUnpaid")}
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void done(false)} className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50">
            {t("delivery.delivered")}
          </button>
        )}
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-white font-semibold">
          {t("delivery.back")}
        </button>
      </div>
    </div>
  );
}

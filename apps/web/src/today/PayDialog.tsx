import type { OrderTotals, Tender } from "@pos/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type OrderDetail } from "../api";
import { cashSuggestions, parsePounds, pounds } from "../format";
import { DiscountDialog } from "./DiscountDialog";
import { moneyError, TotalsBox } from "./money";
import { MethodChoice, WalletPay } from "./WalletPay";

/**
 * Payment for one order: delivery fee and discount or coupon first, then the
 * cash handed over and the change, or a wallet transfer. Cash and wallet can
 * split the bill. Closing it leaves the order to pay later.
 */
export function PayDialog({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged?: () => void }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [tendered, setTendered] = useState("");
  const [fee, setFee] = useState("");
  const [discounting, setDiscounting] = useState(false);
  const [change, setChange] = useState<{ changeCents: number; totals: OrderTotals; method: Tender["method"] } | null>(null);
  const [method, setMethod] = useState<Tender["method"]>("cash");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await api.order(orderId));
    } catch (err) {
      setError(moneyError(err, t));
    }
  }, [orderId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged?.();
    } catch (err) {
      setError(moneyError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const totals = order?.totals;
  const due = totals ? Math.ceil(totals.balanceCents / 100) : 0;
  const open = totals !== undefined && (totals.status === "unpaid" || totals.status === "part_paid");
  const adjustable = totals !== undefined && totals.status === "unpaid" && totals.paidCents === 0;
  const amount = parsePounds(tendered);

  const pay = (tender: Tender) =>
    void run(async () => {
      setChange({ ...(await api.pay(orderId, tender)), method: tender.method });
      setTendered("");
    });
  const payCash = (pounds: number | null) => {
    if (pounds === null || Number.isNaN(pounds) || pounds <= 0) return setError(t("pay.errors.bad_amount"));
    pay({ method: "cash", tenderedPounds: pounds });
  };

  const applyFee = () => {
    const value = parsePounds(fee);
    if (value === null || Number.isNaN(value)) return setError(t("pay.errors.bad_amount"));
    void run(async () => {
      await api.deliveryFee(orderId, value);
      setFee("");
    });
  };

  const key = (label: string, onClick: () => void, tone = "bg-neutral-100 active:bg-neutral-200") => (
    <button key={label} type="button" onClick={onClick} className={`min-h-14 rounded-xl text-xl font-bold ${tone}`}>
      {label}
    </button>
  );
  const typeDigit = (d: string) => setTendered((v) => (v.length < 9 ? v + d : v));

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("today.pay")}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="text-2xl font-bold">{order ? t("pay.title", { number: order.number }) : t("today.pay")}</h2>

        {order && totals && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <TotalsBox totals={totals} taxRateBp={order.taxRateBp} taxName={order.taxNameAr} />

              {adjustable && order.type === "delivery" && (
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{t("pay.feeLabel")}</span>
                  <span className="flex gap-2">
                    <input
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      className="min-h-12 flex-1 rounded-xl border border-neutral-300 px-3 text-lg"
                      data-testid="delivery-fee"
                    />
                    <button type="button" disabled={busy} onClick={applyFee} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white disabled:opacity-50">
                      {t("pay.applyFee")}
                    </button>
                  </span>
                </label>
              )}
              {adjustable && (
                <button type="button" onClick={() => setDiscounting(true)} className="min-h-12 rounded-xl bg-amber-100 font-bold">
                  {t("pay.addDiscount")}
                </button>
              )}

              {notice && (
                <p role="status" className="rounded-xl bg-emerald-100 p-3 font-semibold text-emerald-950">
                  {notice}
                </p>
              )}
              {change && (
                <div className="flex flex-col gap-1 rounded-2xl bg-emerald-100 p-4 text-emerald-950" data-testid="change">
                  {change.totals.status === "paid" ? (
                    <>
                      <span className="text-lg font-bold">{t("pay.paidTitle")}</span>
                      {(change.method === "cash" || change.changeCents > 0) && (
                        <>
                          <span className="text-sm">{t("pay.change")}</span>
                          <span className="text-5xl font-bold">
                            {pounds(change.changeCents)} {t("admin.currency")}
                          </span>
                        </>
                      )}
                      <span className="text-sm">{t("pay.receiptPrinting")}</span>
                    </>
                  ) : (
                    <span className="text-lg font-bold">{t("pay.stillDue", { amount: pounds(change.totals.balanceCents) })}</span>
                  )}
                </div>
              )}
            </div>

            {open && (
              <div className="flex flex-col gap-3">
                <MethodChoice method={method} onChange={setMethod} />
                {method === "wallet" ? (
                  <WalletPay dueCents={totals.balanceCents} busy={busy} label={t("wallet.pay")} onPay={pay} onError={setError} />
                ) : (
                  <>
                    <span className="text-sm font-semibold">{t("pay.tendered")}</span>
                    <output
                      dir="ltr"
                      className="flex min-h-14 items-center justify-end rounded-xl border border-neutral-300 px-4 text-3xl font-bold"
                      data-testid="tendered"
                    >
                      {amount ? pounds(amount * 100) : ""}
                    </output>
                    <div className="flex flex-wrap gap-2">
                      {cashSuggestions(due).map((p) => (
                        <button key={p} type="button" onClick={() => setTendered(String(p))} className="min-h-12 flex-1 rounded-xl bg-amber-100 px-3 font-bold">
                          {pounds(p * 100)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2" dir="ltr">
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => key(d, () => typeDigit(d)))}
                      {key(t("pay.clear"), () => setTendered(""))}
                      {key("0", () => typeDigit("0"))}
                      {key("00", () => typeDigit("00"))}
                    </div>
                    <button
                      type="button"
                      disabled={busy || !amount}
                      onClick={() => payCash(amount)}
                      className="min-h-16 rounded-xl bg-red-700 text-xl font-bold text-white disabled:opacity-50"
                    >
                      {t("pay.payCash")}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-red-100 p-3 font-semibold text-red-900">
            {error}
          </p>
        )}

        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
          {open ? t("pay.later") : t("pay.done")}
        </button>
      </div>

      {discounting && order && (
        <DiscountDialog
          orderId={order.id}
          onClose={() => setDiscounting(false)}
          onApplied={(message) => {
            setDiscounting(false);
            setNotice(message ?? null);
            void load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

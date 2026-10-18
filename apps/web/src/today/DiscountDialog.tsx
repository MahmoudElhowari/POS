import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api";
import { parsePercentBp, parsePounds, pounds } from "../format";
import { moneyError } from "./money";

const COUPON_ERRORS = ["no_coupon", "inactive", "expired", "used_up"];

/**
 * A % or fixed discount, approved on the spot with a manager's PIN, or a
 * coupon code the admin made, which needs no PIN.
 */
export function DiscountDialog({ orderId, onClose, onApplied }: { orderId: string; onClose: () => void; onApplied: (message?: string) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"coupon" | "percent" | "amount">("coupon");
  const [code, setCode] = useState("");
  const [value, setValue] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyCoupon() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.coupon(orderId, code);
      onApplied(t("discount.couponApplied", { code: result.code, amount: pounds(result.amountCents) }));
    } catch (err) {
      const code = err instanceof ApiError ? err.body.error : undefined;
      setError(code && COUPON_ERRORS.includes(code) ? t(`discount.couponErrors.${code}`) : moneyError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const parsed = mode === "percent" ? parsePercentBp(value) : parsePounds(value);
    if (parsed === null || Number.isNaN(parsed) || parsed <= 0 || (mode === "percent" && parsed > 10_000)) return setError(t("pay.errors.bad_amount"));
    setBusy(true);
    setError(null);
    try {
      await api.discount(orderId, mode === "percent" ? { percentBp: parsed } : { amountPounds: parsed }, pin);
      onApplied();
    } catch (err) {
      setError(moneyError(err, t));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `min-h-12 flex-1 rounded-xl font-bold ${on ? "bg-red-700 text-white" : "bg-neutral-100"}`;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("discount.title")}>
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6">
        <h3 className="text-xl font-bold">{t("discount.title")}</h3>
        <div className="flex gap-2">
          <button type="button" aria-pressed={mode === "coupon"} onClick={() => setMode("coupon")} className={chip(mode === "coupon")}>
            {t("discount.coupon")}
          </button>
          <button type="button" aria-pressed={mode === "percent"} onClick={() => setMode("percent")} className={chip(mode === "percent")}>
            {t("discount.percent")}
          </button>
          <button type="button" aria-pressed={mode === "amount"} onClick={() => setMode("amount")} className={chip(mode === "amount")}>
            {t("discount.amount")}
          </button>
        </div>
        {mode === "coupon" ? (
          <>
            <p className="text-sm text-neutral-600">{t("discount.couponHint")}</p>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("discount.couponCode")}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 30))}
                dir="ltr"
                autoComplete="off"
                autoCapitalize="characters"
                className="min-h-12 rounded-xl border border-neutral-300 px-3 text-lg tracking-wider"
              />
            </label>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600">{t("discount.hint")}</p>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("discount.value")}</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                className="min-h-12 rounded-xl border border-neutral-300 px-3 text-lg"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("discount.managerPin")}</span>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="min-h-12 rounded-xl border border-neutral-300 px-3 text-lg tracking-widest"
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-red-100 p-3 font-semibold text-red-900">
            {error}
          </p>
        )}
        {mode === "coupon" ? (
          <button
            type="button"
            disabled={busy || !code.trim()}
            onClick={applyCoupon}
            className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50"
          >
            {t("discount.applyCoupon")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || pin.length < 4 || !value}
            onClick={apply}
            className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50"
          >
            {t("discount.apply")}
          </button>
        )}
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
          {t("discount.cancel")}
        </button>
      </div>
    </div>
  );
}

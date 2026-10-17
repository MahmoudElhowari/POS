import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type OrderDetail, VOID_REASONS, type VoidReason } from "../api";
import { pounds } from "../format";
import { moneyError } from "./money";

/** Void an unpaid order or refund a paid one, always with a reason. */
export function ReasonDialog({ order, mode, onClose, onDone }: { order: OrderDetail; mode: "void" | "refund"; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "void") await api.voidOrder(order.id, reason, note.trim());
      else await api.refund(order.id, reason, note.trim());
      onDone();
    } catch (err) {
      setError(moneyError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "void"
      ? t("reason.voidTitle", { number: order.number })
      : t("reason.refundTitle", { number: order.number, amount: pounds(order.totals.paidCents) });

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-6">
        <h3 className="text-xl font-bold">{title}</h3>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t("reason.choose")}</legend>
          {VOID_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={`min-h-12 rounded-xl px-4 text-start font-bold ${reason === r ? "bg-red-700 text-white" : "bg-neutral-100"}`}
            >
              {t(`reason.reasons.${r}`)}
            </button>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("reason.note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="min-h-12 rounded-xl border border-neutral-300 px-3" />
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-red-100 p-3 font-semibold text-red-900">
            {error}
          </p>
        )}
        <button type="button" disabled={busy || !reason} onClick={confirm} className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50">
          {mode === "void" ? t("reason.confirmVoid") : t("reason.confirmRefund")}
        </button>
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
          {t("reason.back")}
        </button>
      </div>
    </div>
  );
}

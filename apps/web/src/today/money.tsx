import type { OrderStatus, OrderTotals } from "@pos/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api";
import { percentText, pounds } from "../format";

const KNOWN = [
  "not_found",
  "voided",
  "refunded",
  "paid",
  "has_payments",
  "not_paid",
  "not_delivery",
  "too_much",
  "bad_amount",
  "not_approver",
  "locked",
  "no_wallet",
  "over_due",
];

/** The message for a refused money action. */
export function moneyError(err: unknown, t: TFunction) {
  if (err instanceof ApiError && err.body.error && KNOWN.includes(err.body.error)) return t(`pay.errors.${err.body.error}`);
  if (err instanceof ApiError && err.status === 400) return t("pay.errors.bad_amount");
  return t("pay.errors.server");
}

export const statusTone: Record<OrderStatus, string> = {
  unpaid: "bg-amber-100 text-amber-900",
  part_paid: "bg-sky-100 text-sky-900",
  paid: "bg-emerald-100 text-emerald-900",
  voided: "bg-neutral-200 text-neutral-700",
  refunded: "bg-purple-100 text-purple-900",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <span className={`rounded-lg px-2 py-1 text-sm font-bold ${statusTone[status]}`}>{t(`today.status.${status}`)}</span>;
}

/** Subtotal, discount, fee, total, the tax inside it, and what is still due. */
export function TotalsBox({ totals, taxRateBp, taxName }: { totals: OrderTotals; taxRateBp: number; taxName: string }) {
  const { t } = useTranslation();
  const row = (label: string, cents: number, extra = "") => (
    <div className={`flex justify-between gap-4 ${extra}`}>
      <span>{label}</span>
      <span>
        {pounds(cents)} {t("admin.currency")}
      </span>
    </div>
  );
  const extras = totals.discountCents > 0 || totals.deliveryFeeCents > 0;
  const open = totals.status === "unpaid" || totals.status === "part_paid";
  return (
    <div className="flex flex-col gap-1" data-testid="totals">
      {extras && row(t("pay.subtotal"), totals.subtotalCents)}
      {totals.discountCents > 0 && row(t("pay.discount"), -totals.discountCents)}
      {totals.deliveryFeeCents > 0 && row(t("pay.deliveryFee"), totals.deliveryFeeCents)}
      {row(t("pay.total"), totals.totalCents, "text-xl font-bold")}
      {taxRateBp > 0 && (
        <span className="text-sm text-neutral-600">
          {t("pay.taxIncluded", { name: taxName, rate: percentText(taxRateBp), amount: pounds(totals.taxIncludedCents) })}
        </span>
      )}
      {totals.paidCents > 0 && row(t("pay.paid"), totals.paidCents)}
      {open && <div data-testid="due">{row(t("pay.due"), totals.balanceCents, "text-2xl font-bold text-red-700")}</div>}
    </div>
  );
}

import type { Tender, Wallet } from "@pos/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { parsePounds, pounds } from "../format";

/**
 * A mobile wallet payment: which wallet, how much (the amount due to start
 * with, less for a split bill) and the transfer reference from the customer's phone.
 */
export function WalletPay({
  dueCents,
  busy,
  label,
  onPay,
  onError,
}: {
  dueCents: number;
  busy: boolean;
  label: string;
  onPay: (tender: Tender) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(Math.ceil(dueCents / 100)));
  const [reference, setReference] = useState("");

  useEffect(() => {
    api
      .wallets()
      .then((list) => {
        setWallets(list);
        if (list.length === 1) setWallet(list[0]!.key);
      })
      .catch(() => setWallets([]));
  }, []);

  useEffect(() => setAmount(String(Math.ceil(dueCents / 100))), [dueCents]);

  const pay = () => {
    const value = parsePounds(amount);
    if (value === null || Number.isNaN(value) || value <= 0) return onError(t("pay.errors.bad_amount"));
    if (value * 100 > dueCents) return onError(t("pay.errors.over_due"));
    if (!wallet) return onError(t("wallet.pickWallet"));
    if (!reference.trim()) return onError(t("wallet.needReference"));
    onPay({ method: "wallet", wallet, amountPounds: value, reference: reference.trim() });
  };

  const chip = (on: boolean) => `min-h-14 flex-1 whitespace-nowrap rounded-xl px-3 text-lg font-bold ${on ? "bg-red-700 text-white" : "bg-neutral-100"}`;

  return (
    <div className="flex flex-col gap-3" data-testid="wallet-pay">
      <span className="text-sm font-semibold">{t("wallet.which")}</span>
      {wallets?.length === 0 && <p className="text-neutral-600">{t("wallet.none")}</p>}
      <div className="flex flex-wrap gap-2">
        {wallets?.map((w) => (
          <button key={w.key} type="button" aria-pressed={wallet === w.key} onClick={() => setWallet(w.key)} className={chip(wallet === w.key)}>
            {w.nameAr}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t("wallet.amount")}</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          dir="ltr"
          className="min-h-14 rounded-xl border border-neutral-300 px-3 text-2xl font-bold"
          data-testid="wallet-amount"
        />
        <span className="text-sm text-neutral-600">{t("wallet.splitHint", { amount: pounds(dueCents) })}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t("wallet.reference")}</span>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value.slice(0, 60))}
          dir="ltr"
          autoComplete="off"
          className="min-h-14 rounded-xl border border-neutral-300 px-3 text-xl"
          data-testid="wallet-reference"
        />
      </label>
      <button type="button" disabled={busy} onClick={pay} className="min-h-16 rounded-xl bg-red-700 text-xl font-bold text-white disabled:opacity-50">
        {label}
      </button>
    </div>
  );
}

/** Cash or wallet: the choice at the top of a payment. */
export function MethodChoice({ method, onChange }: { method: Tender["method"]; onChange: (m: Tender["method"]) => void }) {
  const { t } = useTranslation();
  const chip = (on: boolean) => `min-h-14 flex-1 rounded-xl text-lg font-bold ${on ? "bg-red-700 text-white" : "bg-neutral-100"}`;
  return (
    <div className="flex gap-2" role="group" aria-label={t("wallet.method")}>
      <button type="button" aria-pressed={method === "cash"} onClick={() => onChange("cash")} className={chip(method === "cash")}>
        {t("wallet.cash")}
      </button>
      <button type="button" aria-pressed={method === "wallet"} onClick={() => onChange("wallet")} className={chip(method === "wallet")}>
        {t("wallet.wallet")}
      </button>
    </div>
  );
}

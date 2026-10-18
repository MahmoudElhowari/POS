import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Coupon } from "../api";
import { parsePercentBp, parsePounds, percentText, pounds } from "../format";

/** Coupon codes the cashier types in the discount dialog. Only the admin makes them. */
export function CouponsList() {
  const { t } = useTranslation();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => setCoupons(await api.coupons()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function attempt(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: t(done) });
      await reload();
      return true;
    } catch (err) {
      const error = err instanceof ApiError ? err.body.error : undefined;
      setMessage({ ok: false, text: t(error === "duplicate" ? "coupons.duplicate" : "staff.error") });
      return false;
    }
  }

  async function add() {
    const amount = mode === "percent" ? parsePercentBp(value) : parsePounds(value);
    const uses = maxUses.trim() ? parsePounds(maxUses) : null;
    if (!code.trim() || amount === null || Number.isNaN(amount) || amount <= 0 || (mode === "percent" && amount > 10_000)) {
      return setMessage({ ok: false, text: t("coupons.bad") });
    }
    if (uses !== null && (Number.isNaN(uses) || uses < 1)) return setMessage({ ok: false, text: t("coupons.bad") });
    const input = { code: code.trim(), ...(mode === "percent" ? { percentBp: amount } : { amountPounds: amount }), endsOn: endsOn || null, maxUses: uses };
    if (await attempt(() => api.addCoupon(input), "coupons.added")) {
      setCode("");
      setValue("");
      setEndsOn("");
      setMaxUses("");
    }
  }

  const off = (c: Coupon) => (c.percentBp !== null ? `${percentText(c.percentBp)}%` : `${pounds(c.amountCents ?? 0)} ${t("admin.currency")}`);
  const chip = (on: boolean) => `min-h-12 flex-1 rounded-xl px-4 font-bold ${on ? "bg-red-700 text-white" : "bg-neutral-100"}`;
  const input = "min-h-12 rounded-xl border border-neutral-300 px-3";

  return (
    <section className="flex max-w-3xl flex-col gap-4" data-testid="coupons">
      <h2 className="text-xl font-bold">{t("coupons.title")}</h2>
      <p className="text-neutral-600">{t("coupons.help")}</p>
      {message && (
        <p role="status" className={`rounded-xl p-3 ${message.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
          {message.text}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {coupons.map((c) => (
          <li
            key={c.id}
            className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white p-4 shadow-sm ${c.active ? "" : "opacity-60"}`}
            data-testid="coupon"
          >
            <bdi dir="ltr" className="min-w-28 text-lg font-bold tracking-wider">
              {c.code}
            </bdi>
            <span className="font-semibold">{t("coupons.off", { amount: off(c) })}</span>
            <span className="text-neutral-700">{c.endsOn ? t("coupons.endsOn", { date: c.endsOn }) : t("coupons.noEnd")}</span>
            <span className="text-neutral-700">
              {c.maxUses !== null ? t("coupons.usesOf", { uses: c.uses, max: c.maxUses }) : t("coupons.uses", { uses: c.uses })}
            </span>
            <label className="ms-auto flex min-h-12 items-center gap-2">
              <input
                type="checkbox"
                className="size-6"
                checked={c.active}
                onChange={(e) => void attempt(() => api.updateCoupon(c.id, { active: e.target.checked }), "staff.saved")}
              />
              {t("staff.active")}
            </label>
          </li>
        ))}
        {!coupons.length && <li className="text-neutral-600">{t("coupons.empty")}</li>}
      </ul>
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{t("coupons.new")}</h3>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("coupons.code")}</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 30))} dir="ltr" className={`${input} tracking-wider`} />
        </label>
        <div className="flex gap-2">
          <button type="button" aria-pressed={mode === "percent"} onClick={() => setMode("percent")} className={chip(mode === "percent")}>
            {t("discount.percent")}
          </button>
          <button type="button" aria-pressed={mode === "amount"} onClick={() => setMode("amount")} className={chip(mode === "amount")}>
            {t("discount.amount")}
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("discount.value")}</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" className={input} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-semibold">{t("coupons.lastDay")}</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} dir="ltr" className={input} />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-semibold">{t("coupons.maxUses")}</span>
            <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" dir="ltr" className={input} />
          </label>
        </div>
        <button type="button" onClick={() => void add()} className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white">
          {t("coupons.add")}
        </button>
      </div>
    </section>
  );
}

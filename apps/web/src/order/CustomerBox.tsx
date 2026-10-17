import type { DraftCustomer, OrderType } from "@pos/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type CustomerMatch } from "../api";

/** Name (required), phone (optional, finds returning customers) and, for delivery, the address. */
export function CustomerBox({ type, customer, onChange }: { type: OrderType; customer: DraftCustomer; onChange: (c: DraftCustomer) => void }) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const phone = customer.phone ?? "";

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 3) return setMatches([]);
    const timer = setTimeout(() => {
      api
        .customers(digits)
        .then((found) => setMatches(found.filter((m) => m.phone !== digits || m.name !== customer.name)))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [phone, customer.name]);

  const set = (patch: Partial<DraftCustomer>) => onChange({ ...customer, ...patch });
  const input = "min-h-12 w-full rounded-xl border border-neutral-300 px-3";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t("order.customer")}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("order.customerName")}</span>
          <input value={customer.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("order.phone")}</span>
          <input
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => set({ phone: e.target.value })}
            maxLength={20}
            className={`${input} text-end`}
          />
        </label>
      </div>
      {matches.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("order.matches")}>
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ name: m.name, phone: m.phone, area: m.area || undefined, directions: m.directions || undefined });
                  setMatches([]);
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-amber-50 px-3 text-start"
              >
                <span className="font-semibold">{m.name}</span>
                <span dir="ltr" className="text-neutral-600">
                  {m.phone}
                </span>
                {m.area && <span className="text-neutral-600">{m.area}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {type === "delivery" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("order.area")}</span>
            <input value={customer.area ?? ""} onChange={(e) => set({ area: e.target.value })} maxLength={80} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("order.directions")}</span>
            <input value={customer.directions ?? ""} onChange={(e) => set({ directions: e.target.value })} maxLength={300} className={input} />
          </label>
        </div>
      )}
    </fieldset>
  );
}

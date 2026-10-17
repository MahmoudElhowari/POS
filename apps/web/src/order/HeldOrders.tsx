import { useTranslation } from "react-i18next";
import type { HeldOrder } from "../api";

/** Orders on hold: tap one to bring it back, or throw it away. */
export function HeldOrders({
  held,
  onRecall,
  onDiscard,
  onClose,
}: {
  held: HeldOrder[];
  onRecall: (h: HeldOrder) => void;
  onDiscard: (h: HeldOrder) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("order.heldTitle")}>
      <div className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="text-xl font-bold">{t("order.heldTitle")}</h2>
        {held.length === 0 && <p className="text-neutral-600">{t("order.noHeld")}</p>}
        <ul className="flex flex-col gap-2">
          {held.map((h) => (
            <li key={h.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRecall(h)}
                className="flex min-h-14 flex-1 items-center gap-3 rounded-xl bg-neutral-100 px-4 text-start"
                data-testid="held-order"
              >
                <span className="font-bold">{h.draft.customer.name}</span>
                <span className="text-neutral-600">
                  {t(`order.types.${h.draft.type}`)}
                  {h.draft.tableNo ? ` · ${t("order.table", { n: h.draft.tableNo })}` : ""}
                </span>
                <span className="text-neutral-600">{t("order.lineCount", { n: h.draft.lines.length })}</span>
                <span dir="ltr" className="ms-auto text-neutral-600">
                  {time(h.updatedAt)}
                </span>
              </button>
              <button type="button" onClick={() => onDiscard(h)} className="min-h-14 rounded-xl bg-red-100 px-4 font-semibold text-red-900">
                {t("order.discard")}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
          {t("order.close")}
        </button>
      </div>
    </div>
  );
}

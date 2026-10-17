import { type DraftLine, MAX_CRUST_STUFFINGS, priceDraft } from "@pos/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Menu, MenuItem } from "../api";
import { pounds } from "../format";

interface Props {
  item: MenuItem;
  menu: Menu;
  /** The line being changed, or undefined for a new one. */
  line?: DraftLine | undefined;
  onSave: (line: DraftLine) => void;
  onClose: () => void;
}

const chip = (on: boolean) => `min-h-12 rounded-xl px-4 font-semibold ${on ? "bg-red-700 text-white" : "bg-neutral-100"}`;

/** Choose size, half-and-half, crust, removals and a note for one item. */
export function ItemSheet({ item, menu, line, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [sizeKey, setSizeKey] = useState(line?.sizeKey ?? item.sizes[0]!.sizeKey);
  const [otherHalfId, setOtherHalfId] = useState(line?.otherHalfId);
  const [pickingHalf, setPickingHalf] = useState(false);
  const [addons, setAddons] = useState<string[]>(line?.addons ?? []);
  const [removals, setRemovals] = useState<string[]>(line?.removals ?? []);
  const [note, setNote] = useState(line?.note ?? "");
  const [qty, setQty] = useState(line?.qty ?? 1);

  const allItems = menu.categories.flatMap((c) => c.items);
  const other = allItems.find((i) => i.id === otherHalfId);
  const halves = allItems.filter((i) => i.halfAndHalf && i.id !== item.id && i.sizes.some((s) => s.sizeKey === sizeKey));
  const builtIn = new Set([...item.includedAddons, ...(other?.includedAddons ?? [])]);
  const stuffings = menu.addons.filter((a) => a.group === "crust_stuffing");
  const hasBuiltInCrust = stuffings.some((a) => builtIn.has(a.key));
  const addonsForSize = item.halfAndHalf ? menu.addons.filter((a) => a.prices[sizeKey] !== undefined) : [];
  const removable = [...item.removable, ...(other?.removable ?? []).filter((r) => !item.removable.some((x) => x.ar === r.ar))];

  const draftLine: DraftLine = {
    itemId: item.id,
    sizeKey,
    ...(otherHalfId ? { otherHalfId } : {}),
    // Drop add-ons that no longer apply after a size or half change.
    addons: addons.filter((k) => addonsForSize.some((a) => a.key === k) && !(hasBuiltInCrust && stuffings.some((s) => s.key === k))),
    removals: removals.filter((r) => removable.some((x) => x.ar === r)),
    ...(note.trim() ? { note: note.trim() } : {}),
    qty,
  };
  const { priced } = priceDraft({ type: "pickup", customer: { name: "-" }, lines: [draftLine] }, menu);

  function toggle(list: string[], set: (v: string[]) => void, key: string) {
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  const stuffingCount = draftLine.addons.filter((k) => stuffings.some((s) => s.key === k)).length;

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={item.nameAr}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <div>
          <h2 className="text-2xl font-bold">{other ? t("order.halfName", { a: item.nameAr, b: other.nameAr }) : item.nameAr}</h2>
          {item.descAr && <p className="text-neutral-600">{item.descAr}</p>}
        </div>

        {item.sizes.length > 1 && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 font-semibold">{t("order.size")}</legend>
            {item.sizes.map((s) => (
              <button key={s.sizeKey} type="button" aria-pressed={sizeKey === s.sizeKey} onClick={() => setSizeKey(s.sizeKey)} className={chip(sizeKey === s.sizeKey)}>
                {s.nameAr} · {pounds(s.priceCents)}
              </button>
            ))}
          </fieldset>
        )}

        {item.halfAndHalf && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t("order.halfAndHalf")}</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={!otherHalfId} onClick={() => {
                  setOtherHalfId(undefined);
                  setPickingHalf(false);
                }} className={chip(!otherHalfId)}>
                {t("order.wholePizza")}
              </button>
              <button type="button" aria-pressed={!!otherHalfId || pickingHalf} onClick={() => setPickingHalf(true)} className={chip(!!otherHalfId || pickingHalf)}>
                {other ? t("order.otherHalf", { name: other.nameAr }) : t("order.chooseHalf")}
              </button>
            </div>
            {pickingHalf && (
              <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3" data-testid="half-picker">
                {halves.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setOtherHalfId(h.id);
                      setPickingHalf(false);
                    }}
                    className={chip(h.id === otherHalfId)}
                  >
                    {h.nameAr}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        )}

        {addonsForSize.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t("order.addons", { max: MAX_CRUST_STUFFINGS })}</legend>
            {hasBuiltInCrust && <p className="text-sm text-neutral-600">{t("order.builtInCrust")}</p>}
            <div className="flex flex-wrap gap-2">
              {addonsForSize.map((a) => {
                const isStuffing = a.group === "crust_stuffing";
                const on = draftLine.addons.includes(a.key);
                const disabled = isStuffing && (hasBuiltInCrust || (!on && stuffingCount >= MAX_CRUST_STUFFINGS));
                return (
                  <button
                    key={a.key}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => toggle(addons, setAddons, a.key)}
                    className={`${chip(on)} disabled:opacity-40`}
                  >
                    {a.nameAr} +{pounds(a.prices[sizeKey]!)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {removable.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t("order.without")}</legend>
            <div className="flex flex-wrap gap-2">
              {removable.map((r) => {
                const on = removals.includes(r.ar);
                return (
                  <button key={r.ar} type="button" aria-pressed={on} onClick={() => toggle(removals, setRemovals, r.ar)} className={chip(on)}>
                    {on ? t("order.withoutName", { name: r.ar }) : r.ar}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("order.lineNote")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="min-h-12 rounded-xl border border-neutral-300 px-3" />
        </label>

        <div className="flex items-center gap-3">
          <span className="font-semibold">{t("order.qty")}</span>
          <button type="button" aria-label={t("order.less")} onClick={() => setQty(Math.max(1, qty - 1))} className="min-h-12 min-w-12 rounded-xl bg-neutral-100 text-2xl font-bold">
            −
          </button>
          <span className="min-w-8 text-center text-xl font-bold" data-testid="sheet-qty">
            {qty}
          </span>
          <button type="button" aria-label={t("order.more")} onClick={() => setQty(Math.min(99, qty + 1))} className="min-h-12 min-w-12 rounded-xl bg-neutral-100 text-2xl font-bold">
            +
          </button>
          <span className="ms-auto text-2xl font-bold" data-testid="sheet-price">
            {priced ? `${pounds(priced.totalCents)} ${t("admin.currency")}` : "—"}
          </span>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={!priced}
            onClick={() => onSave(draftLine)}
            className="min-h-14 flex-1 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50"
          >
            {line ? t("order.saveLine") : t("order.addLine")}
          </button>
          <button type="button" onClick={onClose} className="min-h-14 flex-1 rounded-xl bg-neutral-200 text-lg font-bold">
            {t("admin.edit.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

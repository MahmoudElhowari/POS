import { type DraftLine, type DraftProblem, headerProblems, ORDER_TYPES, type OrderDraft, priceDraft, TABLES } from "@pos/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type HeldOrder, type MenuItem } from "../api";
import { pounds } from "../format";
import { CustomerBox } from "./CustomerBox";
import { HeldOrders } from "./HeldOrders";
import { ItemSheet } from "./ItemSheet";
import { useLiveMenu } from "./useLiveMenu";

const emptyDraft = (): OrderDraft => ({ type: "pickup", customer: { name: "" }, lines: [] });

/** Drops empty optional fields so the draft matches what the server stores. */
function tidy(draft: OrderDraft): OrderDraft {
  const { phone, area, directions } = draft.customer;
  return {
    type: draft.type,
    ...(draft.type === "dine_in" && draft.tableNo !== undefined ? { tableNo: draft.tableNo } : {}),
    customer: {
      name: draft.customer.name.trim(),
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
      ...(draft.type === "delivery" && area?.trim() ? { area: area.trim() } : {}),
      ...(draft.type === "delivery" && directions?.trim() ? { directions: directions.trim() } : {}),
    },
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
    lines: draft.lines,
  };
}

const sameChoice = (a: DraftLine, b: DraftLine) =>
  a.itemId === b.itemId &&
  a.sizeKey === b.sizeKey &&
  a.otherHalfId === b.otherHalfId &&
  a.note === b.note &&
  a.addons.join() === b.addons.join() &&
  a.removals.join() === b.removals.join();

type Notice = { ok: boolean; text: string };

/** The cashier's screen: build an order, hold it or send it. */
export function OrderScreen() {
  const { t } = useTranslation();
  const { menu, error: menuError, reload } = useLiveMenu();
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [heldId, setHeldId] = useState<string | undefined>();
  const [catId, setCatId] = useState<string | undefined>();
  const [sheet, setSheet] = useState<{ item: MenuItem; index?: number } | null>(null);
  const [held, setHeld] = useState<HeldOrder[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHeld = useCallback(async () => setHeld(await api.heldOrders().catch(() => [])), []);
  useEffect(() => {
    void loadHeld();
  }, [loadHeld]);

  const items = useMemo(() => new Map(menu?.categories.flatMap((c) => c.items.map((i) => [i.id, i] as const)) ?? []), [menu]);
  const category = menu?.categories.find((c) => c.id === catId) ?? menu?.categories[0];

  // Price each line on its own so one item going out of stock only marks that line.
  const linePrices = useMemo(
    () => (menu ? draft.lines.map((line) => priceDraft({ ...draft, lines: [line] }, menu).priced?.totalCents ?? null) : []),
    [draft, menu],
  );
  const total = linePrices.every((p) => p !== null) ? linePrices.reduce<number>((sum, p) => sum + (p ?? 0), 0) : null;

  const problemText = (p: DraftProblem) => t(`order.problems.${p.code}`, { line: "line" in p ? p.line + 1 : "" });

  function update(patch: Partial<OrderDraft>) {
    setNotice(null);
    setDraft((d) => ({ ...d, ...patch }));
  }

  function tapItem(item: MenuItem, kind: string) {
    const simple = kind === "other" && item.sizes.length === 1 && item.removable.length === 0;
    if (!simple) return setSheet({ item });
    const line: DraftLine = { itemId: item.id, sizeKey: item.sizes[0]!.sizeKey, addons: [], removals: [], qty: 1 };
    const same = draft.lines.findIndex((l) => sameChoice(l, line));
    if (same >= 0) return changeQty(same, 1);
    update({ lines: [...draft.lines, line] });
  }

  function saveLine(line: DraftLine) {
    const index = sheet?.index;
    update({ lines: index === undefined ? [...draft.lines, line] : draft.lines.map((l, i) => (i === index ? line : l)) });
    setSheet(null);
  }

  function changeQty(index: number, by: number) {
    const lines = draft.lines
      .map((l, i) => (i === index ? { ...l, qty: Math.min(99, l.qty + by) } : l))
      .filter((l) => l.qty > 0);
    update({ lines });
  }

  function reset(next: Notice | null) {
    setDraft(emptyDraft());
    setHeldId(undefined);
    setNotice(next);
  }

  function check(): OrderDraft | null {
    const clean = tidy(draft);
    const problems = headerProblems(clean);
    if (problems.length) {
      setNotice({ ok: false, text: problems.map(problemText).join(" · ") });
      return null;
    }
    return clean;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.body.error === "price_changed") {
        await reload();
        setNotice({ ok: false, text: t("order.priceChanged", { total: pounds(err.body.totalCents ?? 0) }) });
      } else if (err instanceof ApiError && err.body.problems?.length) {
        await reload();
        setNotice({ ok: false, text: err.body.problems.map(problemText).join(" · ") });
      } else if (err instanceof ApiError && err.body.error === "not_held") {
        setHeldId(undefined);
        setNotice({ ok: false, text: t("order.notHeld") });
      } else {
        setNotice({ ok: false, text: t("order.serverError") });
      }
    } finally {
      setBusy(false);
      void loadHeld();
    }
  }

  const send = () => {
    const clean = check();
    if (!clean || total === null) return;
    void run(async () => {
      const sent = await api.send(clean, total, heldId);
      reset({ ok: true, text: t("order.sent", { number: sent.number, total: pounds(sent.totalCents) }) });
    });
  };

  const hold = () => {
    const clean = check();
    if (!clean) return;
    void run(async () => {
      await api.hold(clean, heldId);
      reset({ ok: true, text: t("order.held", { name: clean.customer.name }) });
    });
  };

  if (menuError && !menu) return <p className="rounded-xl bg-red-100 p-4 text-red-900">{t("order.serverError")}</p>;
  if (!menu) return null;

  const chip = (on: boolean) => `min-h-12 rounded-xl px-4 font-bold ${on ? "bg-red-700 text-white" : "bg-white shadow-sm"}`;

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_26rem]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("order.type")}>
          {ORDER_TYPES.map((type) => (
            <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => update({ type })} className={chip(draft.type === type)}>
              {t(`order.types.${type}`)}
            </button>
          ))}
          <button type="button" onClick={() => setShowHeld(true)} className="ms-auto min-h-12 rounded-xl bg-amber-100 px-4 font-bold">
            {t("order.heldButton", { n: held.length })}
          </button>
        </div>

        {draft.type === "dine_in" && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("order.tables")}>
            {TABLES.map((n) => (
              <button key={n} type="button" aria-pressed={draft.tableNo === n} onClick={() => update({ tableNo: n })} className={`${chip(draft.tableNo === n)} min-w-16`}>
                {t("order.table", { n })}
              </button>
            ))}
          </div>
        )}

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={t("order.categories")}>
          {menu.categories.map((c) => (
            <button key={c.id} type="button" onClick={() => setCatId(c.id)} className={`${chip(c.id === category?.id)} shrink-0`}>
              {c.nameAr}
            </button>
          ))}
        </nav>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {category?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => tapItem(item, category.kind)}
                className="flex min-h-24 w-full flex-col justify-between gap-1 rounded-2xl bg-white p-3 text-start shadow-sm active:bg-neutral-100"
                data-testid="menu-item"
              >
                <span className="text-lg font-bold leading-tight">{item.nameAr}</span>
                <span className="text-neutral-600">{item.sizes.map((s) => pounds(s.priceCents)).join(" / ")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <aside className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:self-start" aria-label={t("order.current")}>
        <h2 className="text-xl font-bold">{heldId ? t("order.recalled") : t("order.current")}</h2>
        <CustomerBox type={draft.type} customer={draft.customer} onChange={(customer) => update({ customer })} />

        <ol className="flex flex-col divide-y divide-neutral-200" data-testid="order-lines">
          {draft.lines.length === 0 && <li className="py-6 text-center text-neutral-500">{t("order.empty")}</li>}
          {draft.lines.map((line, index) => {
            const item = items.get(line.itemId);
            const other = line.otherHalfId ? items.get(line.otherHalfId) : undefined;
            const price = linePrices[index];
            const size = item?.sizes.find((s) => s.sizeKey === line.sizeKey);
            return (
              <li key={index} className="flex items-start gap-2 py-2">
                <button type="button" disabled={!item} onClick={() => item && setSheet({ item, index })} className="flex flex-1 flex-col text-start">
                  <span className="font-bold">
                    {other ? t("order.halfName", { a: item?.nameAr, b: other.nameAr }) : (item?.nameAr ?? t("order.gone"))}
                    {size && item && item.sizes.length > 1 ? ` · ${size.nameAr}` : ""}
                  </span>
                  {line.addons.length > 0 && (
                    <span className="text-sm text-neutral-600">+ {line.addons.map((k) => menu.addons.find((a) => a.key === k)?.nameAr ?? k).join("، ")}</span>
                  )}
                  {line.removals.length > 0 && (
                    <span className="text-sm text-red-800">{line.removals.map((r) => t("order.withoutName", { name: r })).join("، ")}</span>
                  )}
                  {line.note && <span className="text-sm text-neutral-600">{line.note}</span>}
                  {price == null && <span className="text-sm font-semibold text-red-700">{t("order.lineUnavailable")}</span>}
                </button>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={t("order.less")} onClick={() => changeQty(index, -1)} className="min-h-12 min-w-12 rounded-xl bg-neutral-100 text-xl font-bold">
                    −
                  </button>
                  <span className="min-w-6 text-center font-bold">{line.qty}</span>
                  <button type="button" aria-label={t("order.more")} onClick={() => changeQty(index, 1)} className="min-h-12 min-w-12 rounded-xl bg-neutral-100 text-xl font-bold">
                    +
                  </button>
                </div>
                <span className="min-w-16 pt-3 text-end font-semibold">{price == null ? "—" : pounds(price)}</span>
              </li>
            );
          })}
        </ol>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("order.orderNote")}</span>
          <input value={draft.note ?? ""} onChange={(e) => update({ note: e.target.value })} maxLength={300} className="min-h-12 rounded-xl border border-neutral-300 px-3" />
        </label>

        <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3 text-2xl font-bold">
          <span>{t("order.total")}</span>
          <span data-testid="order-total">
            {total === null ? "—" : pounds(total)} {t("admin.currency")}
          </span>
        </div>

        {notice && (
          <p role="status" className={`rounded-xl p-3 font-semibold ${notice.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
            {notice.text}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={busy || total === null} onClick={send} className="col-span-3 min-h-16 rounded-xl bg-red-700 text-xl font-bold text-white disabled:opacity-50">
            {t("order.send")}
          </button>
          <button type="button" disabled={busy || draft.lines.length === 0} onClick={hold} className="col-span-2 min-h-12 rounded-xl bg-amber-100 font-bold disabled:opacity-50">
            {t("order.hold")}
          </button>
          <button type="button" disabled={busy} onClick={() => reset(null)} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
            {t("order.new")}
          </button>
        </div>
      </aside>

      {sheet && <ItemSheet item={sheet.item} menu={menu} line={sheet.index === undefined ? undefined : draft.lines[sheet.index]} onSave={saveLine} onClose={() => setSheet(null)} />}
      {showHeld && (
        <HeldOrders
          held={held}
          onClose={() => setShowHeld(false)}
          onRecall={(h) => {
            setDraft(h.draft);
            setHeldId(h.id);
            setNotice(null);
            setShowHeld(false);
          }}
          onDiscard={(h) =>
            void run(async () => {
              await api.discardHeld(h.id);
              if (h.id === heldId) reset(null);
            })
          }
        />
      )}
    </section>
  );
}

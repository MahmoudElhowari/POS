import { parseQty, qtyText, type StockUnit } from "@pos/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminCategory, ApiError, api, type StockMoveView, type StockRow } from "../api";
import { parsePounds, pounds } from "../format";

const UNITS: StockUnit[] = ["g", "ml", "piece"];
const KNOWN = ["not_found", "duplicate", "inactive", "bad_link", "bad_qty"];

function errorText(err: unknown, t: (k: string) => string) {
  const code = err instanceof ApiError ? err.body.error : undefined;
  return t(`inventory.errors.${code && KNOWN.includes(code) ? code : "server"}`);
}

/** A quantity with its unit: "1.25 كغ", "24 قطعة". Negative levels show as they are, so a missing delivery is easy to spot. */
export function Qty({ qty, unit }: { qty: number; unit: StockUnit }) {
  const { t } = useTranslation();
  return (
    <span>
      <bdi dir="ltr">{qtyText(qty, unit)}</bdi> {t(`inventory.units.${unit}`)}
    </span>
  );
}

/**
 * Basic inventory (Milestone 9): each stock item's level and movement, with
 * deliveries, counts and waste. The admin also adds stock items and links them
 * to the menu. No stock warnings for now (Mahmoud, 2026-10-18).
 */
export function InventoryScreen({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.inventory());
    } catch (err) {
      setError(errorText(err, t));
    }
  }, [t]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const chip = (on: boolean) => `min-h-12 rounded-xl px-5 font-bold ${on ? "bg-neutral-900 text-white" : "bg-white"}`;
  const selected = rows?.find((r) => r.id === open);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-2xl font-bold">{t("inventory.title")}</h2>
        <button type="button" aria-pressed={period === "today"} onClick={() => setPeriod("today")} className={chip(period === "today")}>
          {t("inventory.today")}
        </button>
        <button type="button" aria-pressed={period === "week"} onClick={() => setPeriod("week")} className={chip(period === "week")}>
          {t("inventory.week")}
        </button>
      </div>
      {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-start" data-testid="stock">
          <thead className="text-sm text-neutral-600">
            <tr className="border-b border-neutral-200">
              <th className="p-3 text-start">{t("inventory.item")}</th>
              <th className="p-3 text-start">{t("inventory.level")}</th>
              <th className="p-3 text-start">{t("inventory.in")}</th>
              <th className="p-3 text-start">{t("inventory.used")}</th>
              <th className="p-3 text-start">{t("inventory.wasted")}</th>
              <th className="p-3 text-start">{t("inventory.lastCount")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className={`border-b border-neutral-100 ${r.active ? "" : "opacity-50"}`} data-testid="stock-row">
                <td className="p-3 font-bold">{r.nameAr}</td>
                <td className="p-3 text-lg font-bold" data-testid="level">
                  <Qty qty={r.level} unit={r.unit} />
                </td>
                <td className="p-3">{qtyText(r[period].in, r.unit)}</td>
                <td className="p-3">{qtyText(r[period].used, r.unit)}</td>
                <td className="p-3">{qtyText(r[period].wasted, r.unit)}</td>
                <td className="p-3 text-sm">
                  {r.lastCount
                    ? t("inventory.countedOn", {
                        date: r.lastCount.at.slice(0, 10),
                        difference: `${r.lastCount.difference > 0 ? "+" : ""}${qtyText(r.lastCount.difference, r.unit)}`,
                      })
                    : "—"}
                </td>
                <td className="p-3 text-end">
                  <button type="button" onClick={() => setOpen(r.id)} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white">
                    {t("inventory.open")}
                  </button>
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-neutral-500">
                  {t("inventory.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && <AddStockItem onAdded={reload} />}

      {selected && <StockDialog row={selected} isAdmin={isAdmin} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </section>
  );
}

function AddStockItem({ onAdded }: { onAdded: () => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<StockUnit>("g");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    if (!name.trim()) return setMessage({ ok: false, text: t("inventory.badName") });
    try {
      await api.addStockItem({ nameAr: name.trim(), unit });
      setName("");
      setMessage({ ok: true, text: t("inventory.added") });
      await onAdded();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t) });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="add-stock-item">
      <h3 className="text-lg font-bold">{t("inventory.newItem")}</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("inventory.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="min-h-12 rounded-xl border border-neutral-300 px-3" />
        </label>
        <div className="flex gap-2" role="group" aria-label={t("inventory.unit")}>
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`min-h-12 rounded-xl px-4 font-bold ${unit === u ? "bg-red-700 text-white" : "bg-neutral-100"}`}
            >
              {t(`inventory.unitNames.${u}`)}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void add()} className="min-h-12 rounded-xl bg-red-700 px-6 font-bold text-white">
          {t("inventory.add")}
        </button>
      </div>
      {message && (
        <p role="status" className={`rounded-xl p-3 ${message.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

type Action = "delivery" | "count" | "waste";

/** One stock item: record a delivery, a count or waste, see its history, and (admin) its setup. */
function StockDialog({ row, isAdmin, onClose, onChanged }: { row: StockRow; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<Action>("delivery");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [text, setText] = useState("");
  const [moves, setMoves] = useState<StockMoveView[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMoves = useCallback(async () => setMoves(await api.stockMoves(row.id)), [row.id]);
  useEffect(() => {
    void loadMoves();
  }, [loadMoves]);

  async function save() {
    const amount = parseQty(qty, row.unit);
    if (amount === null || Number.isNaN(amount) || (action !== "count" && amount <= 0)) return setMessage({ ok: false, text: t("inventory.errors.bad_qty") });
    const price = cost.trim() ? parsePounds(cost) : null;
    if (price !== null && Number.isNaN(price)) return setMessage({ ok: false, text: t("inventory.errors.bad_cost") });
    setBusy(true);
    setMessage(null);
    try {
      const { level } =
        action === "delivery"
          ? await api.stockDelivery(row.id, { qty: amount, costPounds: price, supplier: text.trim() })
          : action === "count"
            ? await api.stockCount(row.id, amount)
            : await api.stockWaste(row.id, amount, text.trim());
      setMessage({ ok: true, text: t("inventory.saved", { level: `${qtyText(level, row.unit)} ${t(`inventory.units.${row.unit}`)}` }) });
      setQty("");
      setCost("");
      setText("");
      onChanged();
      await loadMoves();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const tab = (a: Action) => (
    <button
      key={a}
      type="button"
      aria-pressed={action === a}
      onClick={() => {
        setAction(a);
        setMessage(null);
      }}
      className={`min-h-12 flex-1 rounded-xl font-bold ${action === a ? "bg-red-700 text-white" : "bg-neutral-100"}`}
    >
      {t(`inventory.actions.${a}`)}
    </button>
  );
  const input = "min-h-12 rounded-xl border border-neutral-300 px-3 text-lg";

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={row.nameAr}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-bold">{row.nameAr}</h2>
          <span className="text-xl font-bold">
            <Qty qty={row.level} unit={row.unit} />
          </span>
        </div>

        {row.active && (
          <>
            <div className="flex gap-2">{(["delivery", "count", "waste"] as Action[]).map(tab)}</div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">
                {t(action === "count" ? "inventory.countedQty" : "inventory.qty", { unit: t(`inventory.units.${row.unit}`) })}
              </span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" dir="ltr" className={input} data-testid="stock-qty" />
            </label>
            {action === "delivery" && (
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">{t("inventory.cost")}</span>
                  <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" dir="ltr" className={input} />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">{t("inventory.supplier")}</span>
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} className={input} />
                </label>
              </div>
            )}
            {action === "waste" && (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{t("inventory.reason")}</span>
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={input} />
              </label>
            )}
            {action === "count" && <p className="text-sm text-neutral-600">{t("inventory.countHint")}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="min-h-14 rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50"
            >
              {t(`inventory.save.${action}`)}
            </button>
          </>
        )}
        {message && (
          <p role="status" className={`rounded-xl p-3 font-semibold ${message.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
            {message.text}
          </p>
        )}

        {isAdmin && <StockSetup row={row} onChanged={onChanged} />}

        <section className="flex flex-col gap-1">
          <h3 className="font-bold">{t("inventory.history")}</h3>
          <ul className="flex flex-col gap-1 text-sm text-neutral-700" data-testid="moves">
            {moves.map((m) => (
              <li key={m.id} className="flex flex-wrap gap-x-2">
                <bdi dir="ltr" className="text-neutral-500">
                  {m.createdAt.slice(0, 10)} {new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </bdi>
                <span className="font-semibold">{t(`inventory.kinds.${m.kind}`)}</span>
                <bdi dir="ltr">{`${m.qty > 0 ? "+" : ""}${qtyText(m.qty, row.unit)}`}</bdi>
                {m.costCents !== null && <span>· {t("inventory.costShown", { amount: pounds(m.costCents) })}</span>}
                {m.supplier && <span>· {m.supplier}</span>}
                {m.note && <span>· {m.note}</span>}
                <span>· {m.staffName}</span>
              </li>
            ))}
            {moves.length === 0 && <li>{t("inventory.noMoves")}</li>}
          </ul>
        </section>

        <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-neutral-200 font-bold">
          {t("inventory.close")}
        </button>
      </div>
    </div>
  );
}

/** The admin's setup for one stock item: on/off, and what on the menu uses it up. */
function StockSetup({ row, onChanged }: { row: StockRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [target, setTarget] = useState("");
  const [sizeKey, setSizeKey] = useState("");
  const [qty, setQty] = useState("1");
  const [takeaway, setTakeaway] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.adminMenu().then((m) => setCategories(m.categories));
  }, []);

  const items = categories.flatMap((c) => c.items);
  const sizes = target.startsWith("kind:")
    ? [
        ...new Map(
          categories.filter((c) => c.kind === target.slice(5)).flatMap((c) => c.items.flatMap((i) => i.sizes.map((s) => [s.sizeKey, s.nameAr] as const))),
        ).entries(),
      ]
    : (items.find((i) => i.id === target)?.sizes.map((s) => [s.sizeKey, s.nameAr] as const) ?? []);
  const sizeName = (link: StockRow["links"][number]) => {
    const all = link.itemId ? items.find((i) => i.id === link.itemId)?.sizes : categories.flatMap((c) => c.items.flatMap((i) => i.sizes));
    return all?.find((s) => s.sizeKey === link.sizeKey)?.nameAr ?? link.sizeKey;
  };

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  function addLink() {
    const amount = parseQty(qty, row.unit);
    if (!target || amount === null || Number.isNaN(amount) || amount <= 0) return setError(t("inventory.errors.bad_link"));
    const kind = target.startsWith("kind:") ? (target.slice(5) as "pizza" | "calzone") : null;
    void run(async () => {
      await api.addStockLink({
        stockItemId: row.id,
        itemId: kind ? null : target,
        categoryKind: kind,
        sizeKey: sizeKey || null,
        qty: amount,
        takeawayOnly: takeaway,
      });
      setTarget("");
      setSizeKey("");
    });
  }

  const select = "min-h-12 rounded-xl border border-neutral-300 bg-white px-3";
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-neutral-50 p-4" data-testid="stock-setup">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{t("inventory.setup")}</h3>
        <label className="flex min-h-12 items-center gap-2">
          <input
            type="checkbox"
            className="size-6"
            checked={row.active}
            onChange={(e) => void run(() => api.updateStockItem(row.id, { active: e.target.checked }))}
          />
          {t("staff.active")}
        </label>
      </div>
      <p className="text-sm text-neutral-600">{t("inventory.linksHelp")}</p>
      <ul className="flex flex-col gap-2">
        {row.links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2">
            <span className="font-semibold">{l.itemNameAr ?? t(`inventory.everyKind.${l.categoryKind}`)}</span>
            <span>· {l.sizeKey ? sizeName(l) : t("inventory.anySize")}</span>
            <span>
              · <Qty qty={l.qty} unit={row.unit} />
            </span>
            {l.takeawayOnly && <span>· {t("inventory.takeawayOnly")}</span>}
            <button
              type="button"
              onClick={() => void run(() => api.removeStockLink(l.id))}
              className="ms-auto min-h-10 rounded-xl bg-red-700 px-3 font-semibold text-white"
            >
              {t("inventory.removeLink")}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("inventory.menuItem")}</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setSizeKey("");
            }}
            className={select}
          >
            <option value="">—</option>
            <option value="kind:pizza">{t("inventory.everyKind.pizza")}</option>
            <option value="kind:calzone">{t("inventory.everyKind.calzone")}</option>
            {categories.map((c) => (
              <optgroup key={c.id} label={c.nameAr}>
                {c.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nameAr}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("inventory.size")}</span>
          <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)} className={select}>
            <option value="">{t("inventory.anySize")}</option>
            {sizes.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-24 flex-col gap-1">
          <span className="text-sm font-semibold">{t(`inventory.units.${row.unit}`)}</span>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="min-h-12 rounded-xl border border-neutral-300 px-3"
          />
        </label>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" className="size-6" checked={takeaway} onChange={(e) => setTakeaway(e.target.checked)} />
          {t("inventory.takeawayOnly")}
        </label>
        <button type="button" onClick={addLink} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white">
          {t("inventory.addLink")}
        </button>
      </div>
      {error && <p className="rounded-xl bg-red-100 p-3 text-red-900">{error}</p>}
    </section>
  );
}

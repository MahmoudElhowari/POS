import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Driver } from "../api";

/** Delivery drivers: names the cashier picks from on the delivery board. They have no PIN. */
export function DriversList() {
  const { t } = useTranslation();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => setDrivers(await api.drivers()), []);
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
      const code = err instanceof ApiError ? err.body.error : undefined;
      setMessage({ ok: false, text: t(code === "duplicate" ? "drivers.duplicate" : "staff.error") });
      return false;
    }
  }

  async function add() {
    if (!name.trim()) return setMessage({ ok: false, text: t("drivers.badName") });
    if (await attempt(() => api.addDriver(name.trim()), "drivers.added")) setName("");
  }

  const input = "min-h-12 rounded-xl border border-neutral-300 px-3";
  return (
    <section className="flex max-w-3xl flex-col gap-4" data-testid="drivers">
      <h2 className="text-xl font-bold">{t("drivers.title")}</h2>
      <p className="text-neutral-600">{t("drivers.help")}</p>
      {message && <p className={`rounded-xl p-3 ${message.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{message.text}</p>}
      <ul className="flex flex-col gap-2">
        {drivers.map((d) => (
          <li key={d.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ${d.active ? "" : "opacity-60"}`}>
            <span className="min-w-28 text-lg font-bold">{d.name}</span>
            <label className="ms-auto flex min-h-12 items-center gap-2">
              <input
                type="checkbox"
                className="size-6"
                checked={d.active}
                onChange={(e) => void attempt(() => api.updateDriver(d.id, { active: e.target.checked }), "staff.saved")}
              />
              {t("staff.active")}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("drivers.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <button type="button" onClick={() => void add()} className="min-h-12 rounded-xl bg-red-700 px-6 font-bold text-white">
          {t("drivers.add")}
        </button>
      </div>
    </section>
  );
}

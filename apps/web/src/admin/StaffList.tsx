import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Staff, type StaffMember } from "../api";

const ROLES: Staff["role"][] = ["cashier", "manager", "admin"];
const PIN = /^\d{4,6}$/;

/** Add staff, change their PIN or role, and turn them off when they leave. */
export function StaffList() {
  const { t } = useTranslation();
  const [people, setPeople] = useState<StaffMember[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Staff["role"]>("cashier");
  const [pin, setPin] = useState("");
  const [newPins, setNewPins] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => setPeople(await api.staff()), []);
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
      setMessage({ ok: false, text: t(code === "pin_taken" || code === "last_admin" ? `staff.${code}` : "staff.error") });
      return false;
    }
  }

  async function add() {
    if (!name.trim() || !PIN.test(pin)) return setMessage({ ok: false, text: t("staff.badInput") });
    if (await attempt(() => api.addStaff({ name: name.trim(), role, pin }), "staff.added")) {
      setName("");
      setPin("");
    }
  }

  async function changePin(person: StaffMember) {
    const next = newPins[person.id] ?? "";
    if (!PIN.test(next)) return setMessage({ ok: false, text: t("staff.badInput") });
    if (await attempt(() => api.updateStaff(person.id, { pin: next }), "staff.saved")) setNewPins({ ...newPins, [person.id]: "" });
  }

  const input = "min-h-12 rounded-xl border border-neutral-300 px-3";
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-xl font-bold">{t("staff.title")}</h2>
      {message && <p className={`rounded-xl p-3 ${message.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{message.text}</p>}

      <ul className="flex flex-col gap-2">
        {people.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ${p.active ? "" : "opacity-60"}`}>
            <span className="min-w-28 text-lg font-bold">{p.name}</span>
            <select
              aria-label={t("staff.role")}
              value={p.role}
              onChange={(e) => void attempt(() => api.updateStaff(p.id, { role: e.target.value as Staff["role"] }), "staff.saved")}
              className={input}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`staff.roles.${r}`)}
                </option>
              ))}
            </select>
            <input
              inputMode="numeric"
              dir="ltr"
              type="password"
              aria-label={`${t("staff.newPin")} ${p.name}`}
              placeholder={t("staff.newPin")}
              value={newPins[p.id] ?? ""}
              onChange={(e) => setNewPins({ ...newPins, [p.id]: e.target.value })}
              className={`${input} w-32`}
            />
            <button type="button" onClick={() => void changePin(p)} className="min-h-12 rounded-xl bg-neutral-200 px-4 font-semibold">
              {t("staff.changePin")}
            </button>
            <label className="ms-auto flex min-h-12 items-center gap-2">
              <input
                type="checkbox"
                className="size-6"
                checked={p.active}
                onChange={(e) => void attempt(() => api.updateStaff(p.id, { active: e.target.checked }), "staff.saved")}
              />
              {t("staff.active")}
            </label>
          </li>
        ))}
      </ul>

      <fieldset className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <legend className="px-1 font-bold">{t("staff.add")}</legend>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("staff.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("staff.role")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Staff["role"])} className={input}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`staff.roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("staff.pin")}</span>
          <input inputMode="numeric" dir="ltr" type="password" value={pin} onChange={(e) => setPin(e.target.value)} className={`${input} w-32`} />
        </label>
        <button type="button" onClick={() => void add()} className="min-h-12 rounded-xl bg-red-700 px-6 font-bold text-white">
          {t("staff.addButton")}
        </button>
      </fieldset>
    </section>
  );
}

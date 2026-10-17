import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminMenu, api, setSession, type Staff } from "../api";
import { Addons } from "./Addons";
import { BulkPrices } from "./BulkPrices";
import { MenuItems } from "./MenuItems";
import { PinPad } from "./PinPad";
import { useIdleLock } from "./useIdleLock";

const IDLE_LOCK_MS = 10 * 60_000;
const STORAGE_KEY = "pos.admin.token";

function storedToken() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the session simply does not survive a reload.
  }
}

type Tab = "items" | "addons" | "bulk";

export function AdminScreen() {
  const { t } = useTranslation();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [checking, setChecking] = useState(true);

  const signOut = useCallback(() => {
    void api.logout().catch(() => {});
    setSession(null);
    storeToken(null);
    setStaff(null);
    setMenu(null);
  }, []);

  const reload = useCallback(async () => setMenu(await api.adminMenu()), []);

  useEffect(() => {
    const token = storedToken();
    if (!token) return setChecking(false);
    setSession(token, signOut);
    api
      .me()
      .then((me) => (me.role === "admin" ? setStaff(me) : signOut()))
      .catch(() => signOut())
      .finally(() => setChecking(false));
  }, [signOut]);

  useEffect(() => {
    if (staff) void reload();
  }, [staff, reload]);

  useIdleLock(staff !== null, IDLE_LOCK_MS, signOut);

  if (checking) return null;
  if (!staff) {
    return (
      <PinPad
        onSignedIn={(token, who) => {
          setSession(token, signOut);
          storeToken(token);
          setStaff(who);
        }}
      />
    );
  }

  const tabs: Tab[] = ["items", "addons", "bulk"];
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`min-h-12 rounded-xl px-5 font-bold ${tab === key ? "bg-neutral-900 text-white" : "bg-white"}`}
          >
            {t(`admin.tabs.${key}`)}
          </button>
        ))}
        <span className="ms-auto text-neutral-600">{staff.name}</span>
        <button type="button" onClick={signOut} className="min-h-12 rounded-xl bg-white px-5 font-bold">
          {t("nav.signOut")}
        </button>
      </div>
      {menu && tab === "items" && <MenuItems categories={menu.categories} addons={menu.addons} reload={reload} />}
      {menu && tab === "addons" && <Addons addons={menu.addons} reload={reload} />}
      {tab === "bulk" && <BulkPrices reload={reload} />}
    </section>
  );
}

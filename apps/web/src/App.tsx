import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminScreen } from "./admin/AdminScreen";
import { PinPad } from "./admin/PinPad";
import { useIdleLock } from "./admin/useIdleLock";
import { api, setSession, type Staff } from "./api";
import { DeliveryBoard } from "./delivery/DeliveryBoard";
import { OrderScreen } from "./order/OrderScreen";
import { PrinterTest } from "./PrinterTest";
import { ReportsScreen } from "./reports/ReportsScreen";
import { TodayOrders } from "./today/TodayOrders";

type Route = "order" | "today" | "delivery" | "reports" | "menu" | "printer";
const ROUTES: Route[] = ["order", "today", "delivery", "reports", "menu", "printer"];
const routeFromHash = (): Route => ROUTES.find((r) => window.location.hash === `#/${r}`) ?? "order";

const IDLE_LOCK_MS = 10 * 60_000;
const STORAGE_KEY = "pos.session";

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

export function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const signOut = useCallback(() => {
    void api.logout().catch(() => {});
    setSession(null);
    storeToken(null);
    setStaff(null);
  }, []);

  // A reload keeps the person signed in until the server session ends.
  useEffect(() => {
    const token = storedToken();
    if (!token) return setChecking(false);
    setSession(token, signOut);
    api
      .me()
      .then(setStaff)
      .catch(() => signOut())
      .finally(() => setChecking(false));
  }, [signOut]);

  // The next person signs in with their own PIN.
  useIdleLock(staff !== null, IDLE_LOCK_MS, signOut);

  const routes: Route[] =
    staff?.role === "admin"
      ? ["order", "today", "delivery", "reports", "menu", "printer"]
      : staff?.role === "manager"
        ? ["order", "today", "delivery", "reports", "printer"]
        : ["order", "today", "delivery", "printer"];

  let screen;
  if (route === "printer") screen = <PrinterTest />;
  else if (checking) screen = null;
  else if (!staff)
    screen = (
      <PinPad
        onSignedIn={(token, who) => {
          setSession(token, signOut);
          storeToken(token);
          setStaff(who);
        }}
      />
    );
  else if (route === "menu" && staff.role !== "admin") screen = <p className="rounded-xl bg-red-100 p-4 text-red-900">{t("pin.forbidden")}</p>;
  else if (route === "menu") screen = <AdminScreen />;
  else if (route === "today") screen = <TodayOrders />;
  else if (route === "delivery") screen = <DeliveryBoard />;
  else if (route === "reports" && staff.role === "cashier") screen = <p className="rounded-xl bg-red-100 p-4 text-red-900">{t("pin.forbidden")}</p>;
  else if (route === "reports") screen = <ReportsScreen />;
  else screen = <OrderScreen />;

  return (
    <main className="min-h-screen bg-neutral-50 p-4 text-neutral-900 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-bold">{t("appName")}</h1>
        <nav className="ms-auto flex flex-wrap items-center gap-2">
          {routes.map((r) => (
            <a
              key={r}
              href={`#/${r}`}
              className={`flex min-h-12 items-center rounded-xl px-4 font-semibold ${route === r ? "bg-red-700 text-white" : "bg-white"}`}
            >
              {t(`nav.${r}`)}
            </a>
          ))}
          {staff && (
            <>
              <span className="px-2 text-neutral-600" data-testid="signed-in-as">
                {staff.name}
              </span>
              <button type="button" onClick={signOut} className="min-h-12 rounded-xl bg-white px-4 font-semibold">
                {t("nav.signOut")}
              </button>
            </>
          )}
        </nav>
      </header>
      {screen}
    </main>
  );
}

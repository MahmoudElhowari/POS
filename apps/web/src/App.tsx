import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminScreen } from "./admin/AdminScreen";
import { PrinterTest } from "./PrinterTest";

type Route = "menu" | "printer";
const routeFromHash = (): Route => (window.location.hash === "#/printer" ? "printer" : "menu");

export function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <main className="min-h-screen bg-neutral-50 p-4 text-neutral-900 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-bold">{t("appName")}</h1>
        <nav className="ms-auto flex gap-2">
          {(["menu", "printer"] as const).map((r) => (
            <a
              key={r}
              href={`#/${r}`}
              className={`flex min-h-12 items-center rounded-xl px-4 font-semibold ${route === r ? "bg-red-700 text-white" : "bg-white"}`}
            >
              {t(`nav.${r}`)}
            </a>
          ))}
        </nav>
      </header>
      {route === "menu" ? <AdminScreen /> : <PrinterTest />}
    </main>
  );
}

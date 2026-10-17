import { useTranslation } from "react-i18next";
import { PrinterTest } from "./PrinterTest";

export function App() {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen bg-neutral-50 p-6 text-neutral-900">
      <h1 className="mb-8 text-3xl font-bold">{t("appName")}</h1>
      <PrinterTest />
    </main>
  );
}

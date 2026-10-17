import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen bg-neutral-50 p-6 text-neutral-900">
      <h1 className="text-3xl font-bold">{t("appName")}</h1>
      <p className="mt-2 text-lg">{t("setupComplete")}</p>
    </main>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdminMenu, api } from "../api";
import { Addons } from "./Addons";
import { AuditLog } from "./AuditLog";
import { CouponsList } from "./CouponsList";
import { BulkPrices } from "./BulkPrices";
import { DriversList } from "./DriversList";
import { MenuItems } from "./MenuItems";
import { SettingsForm } from "./SettingsForm";
import { StaffList } from "./StaffList";

type Tab = "items" | "addons" | "bulk" | "staff" | "coupons" | "settings" | "audit";

/** Back office for the admin (sign-in is handled by App). */
export function AdminScreen() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [tab, setTab] = useState<Tab>("items");

  const reload = useCallback(async () => setMenu(await api.adminMenu()), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tabs: Tab[] = ["items", "addons", "bulk", "staff", "coupons", "settings", "audit"];
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
      </div>
      {menu && tab === "items" && <MenuItems categories={menu.categories} addons={menu.addons} reload={reload} />}
      {menu && tab === "addons" && <Addons addons={menu.addons} reload={reload} />}
      {tab === "bulk" && <BulkPrices reload={reload} />}
      {tab === "staff" && (
        <div className="flex flex-col gap-8">
          <StaffList />
          <DriversList />
        </div>
      )}
      {tab === "coupons" && <CouponsList />}
      {tab === "settings" && <SettingsForm />}
      {tab === "audit" && <AuditLog />}
    </section>
  );
}

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const ADMIN_PIN = process.env.E2E_ADMIN_PIN ?? "1234";
const CASHIER_PIN = "2468";
const MANAGER_PIN = "1357";

test.beforeAll(async ({ request }) => {
  const { token } = await (await request.post("/api/auth/pin", { data: { pin: ADMIN_PIN } })).json();
  const headers = { authorization: `Bearer ${token}` };
  for (const person of [
    { name: "كاشير الاختبار", role: "cashier", pin: CASHIER_PIN },
    { name: "مشرف الاختبار", role: "manager", pin: MANAGER_PIN },
  ]) {
    const res = await request.post("/api/admin/staff", { headers, data: person });
    expect([201, 409]).toContain(res.status());
  }
});

async function signIn(page: Page, pin: string) {
  await page.goto("/#/order");
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
}

async function openDashboard(page: Page) {
  await page.getByRole("link", { name: "التقارير" }).click();
  await page.getByRole("button", { name: "لوحة المبيعات" }).click();
  await page.getByRole("button", { name: "اليوم", exact: true }).click();
  await expect(page.getByRole("button", { name: "اليوم", exact: true })).toHaveAttribute("aria-pressed", "true");
}

/** A whole number of pounds from a card such as "12,500 ل.س". */
const number = async (page: Page, testId: string) => Number((await page.getByTestId(testId).locator("span").nth(1).innerText()).replace(/[^\d]/g, ""));

test("a sale shows up on today's dashboard, by hour and by item, and downloads as CSV", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await openDashboard(page);
  const sales = await number(page, "headline-salesCents");
  const orders = await number(page, "headline-orders");
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  // A pickup Corn pizza (750), paid cash.
  await signIn(page, CASHIER_PIN);
  await page.getByRole("link", { name: "طلب جديد" }).click();
  await page.getByRole("button", { name: "استلام", exact: true }).click();
  await page.getByLabel("اسم الزبون").fill("زبون اللوحة");
  await page.getByRole("button", { name: "المميزة" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "بيتزا ذرة" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  const pay = page.getByRole("dialog", { name: "الدفع" });
  for (const digit of "750") await pay.getByRole("button", { name: digit, exact: true }).click();
  await pay.getByRole("button", { name: "ادفع نقداً" }).click();
  await pay.getByRole("button", { name: "تم" }).click();
  // Cashiers have no reports.
  await expect(page.getByRole("link", { name: "التقارير" })).toHaveCount(0);
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  await signIn(page, MANAGER_PIN);
  await openDashboard(page);
  await expect.poll(() => number(page, "headline-salesCents")).toBe(sales + 750);
  expect(await number(page, "headline-orders")).toBe(orders + 1);
  await expect(page.getByTestId("hour-bar").first()).toBeVisible();
  await expect(page.getByTestId("items")).toContainText("بيتزا ذرة · وسط");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "تنزيل الأصناف (CSV)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^romantica-items-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.startsWith("﻿الصنف,")).toBe(true);
  expect(csv).toContain("بيتزا ذرة,وسط,");
});

test("two chosen dates show a bar for each day and the weekday averages, starting on Sunday", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await openDashboard(page);
  const today = (await page.getByTestId("period").innerText()).trim();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 9 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("من", { exact: true }).fill(from);
  await page.getByLabel("إلى", { exact: true }).fill(today);
  await page.getByRole("button", { name: "عرض" }).click();
  await expect(page.getByTestId("period")).toContainText(`من ${from} إلى ${today}`);
  await expect(page.getByTestId("day-bar")).toHaveCount(10);
  const weekdays = page.getByRole("table").filter({ has: page.getByRole("cell", { name: "السبت" }) });
  await expect(weekdays.getByRole("row").nth(1)).toContainText("الأحد");
});

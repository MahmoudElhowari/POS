import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const receipts = fileURLToPath(new URL("../../printer-output/receipt/", import.meta.url));
const pngs = () => {
  try {
    return readdirSync(receipts).filter((f) => f.endsWith(".png")).length;
  } catch {
    return 0;
  }
};

const ADMIN_PIN = process.env.E2E_ADMIN_PIN ?? "1234";
const CASHIER_PIN = "2468";
const MANAGER_PIN = "1357";

test.beforeAll(async ({ request }) => {
  const { token } = await (await request.post("/api/auth/pin", { data: { pin: ADMIN_PIN } })).json();
  for (const person of [
    { name: "كاشير الاختبار", role: "cashier", pin: CASHIER_PIN },
    { name: "مشرف الاختبار", role: "manager", pin: MANAGER_PIN },
  ]) {
    const res = await request.post("/api/admin/staff", { headers: { authorization: `Bearer ${token}` }, data: person });
    expect([201, 409]).toContain(res.status());
  }
});

async function signIn(page: Page, pin: string) {
  await page.goto("/#/order");
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
}

/** A can of cola (100). */
async function sendCola(page: Page, type: string, name: string) {
  await page.getByRole("button", { name: type, exact: true }).click();
  if (type === "داخل المطعم") await page.getByRole("button", { name: "طاولة 5" }).click();
  await page.getByLabel("اسم الزبون").fill(name);
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  await expect(page.getByRole("status")).toContainText("تم إرسال الطلب");
}

test("a cashier cannot open the reports", async ({ page }) => {
  await signIn(page, CASHIER_PIN);
  await expect(page.getByRole("link", { name: "التقارير" })).toHaveCount(0);
  await page.goto("/#/reports");
  await expect(page.getByText("هذه الشاشة للمدير فقط")).toBeVisible();
});

test("a manager prints an X, deals with unpaid orders, counts the drawer and closes the day", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await sendCola(page, "داخل المطعم", "طاولة الإغلاق");
  await sendCola(page, "استلام", "استلام الإغلاق");
  const pay = page.getByRole("dialog", { name: "الدفع" });
  await pay.getByRole("button", { name: "100", exact: true }).click();
  await pay.getByRole("button", { name: "ادفع نقداً" }).click();
  await pay.getByRole("button", { name: "تم" }).click();

  await page.getByRole("link", { name: "التقارير" }).click();
  await page.getByLabel("الرصيد الافتتاحي في الصندوق (ل.س)").fill("500");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("status")).toHaveText("تم حفظ الرصيد الافتتاحي");
  const before = pngs();
  await page.getByRole("button", { name: "طباعة تقرير X" }).click();
  await expect.poll(pngs, { timeout: 20_000 }).toBe(before + 1);

  await page.getByRole("button", { name: "إغلاق اليوم", exact: true }).click();
  const unresolved = page.getByTestId("unresolved");
  await expect(unresolved).toContainText("طاولة الإغلاق");
  const close = page.getByRole("button", { name: "إغلاق اليوم وطباعة تقرير Z" });
  await expect(close).toBeDisabled();
  // Leave every unpaid dine-in or pickup order unpaid (earlier test runs may have left some too).
  while ((await unresolved.locator("li").count()) > 0) {
    const count = await unresolved.locator("li").count();
    await unresolved.getByRole("button", { name: "تركه غير مدفوع" }).first().click();
    await expect(unresolved.locator("li")).toHaveCount(count - 1);
  }

  await page.getByLabel("عدد أوراق 500").fill("2");
  await page.getByLabel("فراطة وأخرى (ل.س)").fill("25");
  await expect(page.getByTestId("counted")).toContainText("1,025 ل.س");
  const zBefore = pngs();
  await close.click();
  await expect(page.getByTestId("closed")).toContainText(/تم إغلاق اليوم · تقرير Z رقم \d+/);
  await expect(page.getByTestId("report")).toContainText("طاولة الإغلاق"); // listed under left unpaid
  await expect.poll(pngs, { timeout: 20_000 }).toBe(zBefore + 1);

  await page.getByRole("button", { name: "تقارير Z السابقة" }).click();
  await expect(page.getByTestId("z-history").locator("li").first()).toContainText("مشرف الاختبار");

  // The next day starts again at order 1.
  await page.getByRole("link", { name: "طلب جديد" }).click();
  await sendCola(page, "داخل المطعم", "اليوم الجديد");
  await expect(page.getByRole("status")).toContainText("تم إرسال الطلب رقم 1 ·");
});

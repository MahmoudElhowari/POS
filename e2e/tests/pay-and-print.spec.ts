import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Both printers are fake for now: each saves its tickets as PNGs here.
const output = (printer: "receipt" | "kitchen") => fileURLToPath(new URL(`../../printer-output/${printer}/`, import.meta.url));
const pngs = (printer: "receipt" | "kitchen") => {
  try {
    return readdirSync(output(printer)).filter((f) => f.endsWith(".png")).length;
  } catch {
    return 0;
  }
};

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

async function signInAsCashier(page: Page) {
  await page.goto("/#/order");
  for (const digit of CASHIER_PIN) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("كاشير الاختبار");
}

/** Corn Regular (750) + a can of cola (100) = 850. */
async function buildOrder(page: Page, type: string, name: string) {
  await page.getByRole("button", { name: type, exact: true }).click();
  if (type === "داخل المطعم") await page.getByRole("button", { name: "طاولة 3" }).click();
  await page.getByLabel("اسم الزبون").fill(name);
  await page.getByRole("button", { name: "المميزة" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "بيتزا ذرة" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await expect(page.getByTestId("order-total")).toHaveText("850 ل.س");
}

test("sending prints a kitchen ticket, and paying cash shows the change and prints the receipt", async ({ page }) => {
  await signInAsCashier(page);
  await buildOrder(page, "استلام", "زبون الدفع");
  const kitchenBefore = pngs("kitchen");
  const receiptBefore = pngs("receipt");

  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  const pay = page.getByRole("dialog", { name: "الدفع" });
  await expect(pay.getByRole("heading", { name: /الدفع · طلب رقم \d+/ })).toBeVisible();
  await expect(pay.getByTestId("due")).toContainText("850 ل.س");
  await expect(pay.getByTestId("totals")).toContainText("يشمل ضريبة 5%: 40 ل.س");
  await expect.poll(() => pngs("kitchen"), { timeout: 20_000 }).toBe(kitchenBefore + 1);

  await pay.getByRole("button", { name: "1,000", exact: true }).click();
  await pay.getByRole("button", { name: "ادفع نقداً" }).click();
  await expect(pay.getByTestId("change")).toContainText("150 ل.س");
  await expect.poll(() => pngs("receipt"), { timeout: 20_000 }).toBe(receiptBefore + 1);
  await pay.getByRole("button", { name: "تم" }).click();
  await expect(pay).toBeHidden();
});

test("a delivery fee and a manager-approved discount change what is due; paying later leaves it unpaid", async ({ page }) => {
  await signInAsCashier(page);
  const name = `زبون التوصيل ${Date.now() % 100_000}`;
  await buildOrder(page, "توصيل", name);
  await page.getByRole("button", { name: "إرسال الطلب" }).click();

  const pay = page.getByRole("dialog", { name: "الدفع" });
  await pay.getByTestId("delivery-fee").fill("300");
  await pay.getByRole("button", { name: "تطبيق" }).click();
  await expect(pay.getByTestId("due")).toContainText("1,150 ل.س");

  await pay.getByRole("button", { name: "خصم (بموافقة المشرف)" }).click();
  const discount = page.getByRole("dialog", { name: "خصم على الطلب" });
  await discount.getByLabel("قيمة الخصم").fill("10");
  await discount.getByLabel("رمز المشرف").fill(CASHIER_PIN);
  await discount.getByRole("button", { name: "تطبيق الخصم" }).click();
  await expect(discount.getByRole("alert")).toHaveText("رمز المشرف غير صحيح"); // a cashier cannot approve

  await discount.getByLabel("رمز المشرف").fill(MANAGER_PIN);
  await discount.getByRole("button", { name: "تطبيق الخصم" }).click();
  await expect(discount).toBeHidden();
  // 850 − 10% (85) + 300 = 1,065
  await expect(pay.getByTestId("due")).toContainText("1,065 ل.س");

  await pay.getByRole("button", { name: "الدفع لاحقاً" }).click();
  await page.getByRole("link", { name: "طلبات اليوم" }).click();
  const row = page.getByTestId("today-order").filter({ hasText: name });
  await expect(row).toContainText("غير مدفوع");
  await row.click();
  await expect(page.getByTestId("history")).toContainText("بموافقة مشرف الاختبار");
});

test("a cashier voids an unpaid dine-in order with a reason", async ({ page }) => {
  await signInAsCashier(page);
  const name = `زبون الإلغاء ${Date.now() % 100_000}`;
  await buildOrder(page, "داخل المطعم", name);
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  await expect(page.getByRole("status")).toContainText("تم إرسال الطلب");
  await expect(page.getByRole("dialog")).toHaveCount(0); // dine-in pays at the end of the meal

  await page.getByRole("link", { name: "طلبات اليوم" }).click();
  await page.getByTestId("today-order").filter({ hasText: name }).click();
  const panel = page.getByTestId("order-panel");
  await panel.getByRole("button", { name: "إلغاء الطلب" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "الزبون ألغى الطلب" }).click();
  await dialog.getByRole("button", { name: "تأكيد الإلغاء" }).click();

  await expect(panel.getByText("ملغى", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("history")).toContainText("الزبون ألغى الطلب");
  await expect(panel.getByRole("button", { name: "الدفع" })).toHaveCount(0);
});

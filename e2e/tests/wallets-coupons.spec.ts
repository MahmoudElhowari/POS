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
// A new code each run, so its uses start at zero.
const CODE = `E2E${Date.now() % 100_000}`;

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

test("the admin makes a coupon, and the cashier uses it and splits the bill between a wallet and cash", async ({ page }) => {
  await signIn(page, ADMIN_PIN);
  await page.getByRole("link", { name: "القائمة" }).click();
  await page.getByRole("button", { name: "الكوبونات" }).click();
  const coupons = page.getByTestId("coupons");
  await coupons.getByLabel("الرمز").fill(CODE.toLowerCase());
  await coupons.getByRole("button", { name: "مبلغ ل.س" }).click();
  await coupons.getByLabel("قيمة الخصم").fill("20");
  await coupons.getByLabel("عدد الطلبات المسموح (اختياري)").fill("5");
  await coupons.getByRole("button", { name: "إضافة الكوبون" }).click();
  await expect(coupons.getByRole("status")).toHaveText("تمت إضافة الكوبون");
  await expect(coupons.getByTestId("coupon").filter({ hasText: CODE })).toContainText("استُخدم 0 من 5");
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  // One can of cola (100), pickup.
  await signIn(page, CASHIER_PIN);
  await page.getByRole("link", { name: "طلب جديد" }).click();
  await page.getByRole("button", { name: "استلام", exact: true }).click();
  await page.getByLabel("اسم الزبون").fill(`زبون المحفظة ${CODE}`);
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();

  const pay = page.getByRole("dialog", { name: "الدفع" });
  await pay.getByRole("button", { name: "خصم أو كوبون" }).click();
  const discount = page.getByRole("dialog", { name: "خصم أو كوبون" });
  await discount.getByLabel("رمز الكوبون").fill("NOPE");
  await discount.getByRole("button", { name: "تطبيق الكوبون" }).click();
  await expect(discount.getByRole("alert")).toHaveText("لا يوجد كوبون بهذا الرمز");
  await discount.getByLabel("رمز الكوبون").fill(CODE);
  await discount.getByRole("button", { name: "تطبيق الكوبون" }).click();
  await expect(discount).toBeHidden();
  await expect(pay.getByRole("status").filter({ hasText: "كوبون" })).toContainText("خصم 20 ل.س");
  await expect(pay.getByTestId("due")).toContainText("80 ل.س");

  // 50 by Syriatel Cash, the other 30 in cash.
  await pay.getByRole("button", { name: "محفظة", exact: true }).click();
  const wallet = pay.getByTestId("wallet-pay");
  await wallet.getByRole("button", { name: "سيريتل كاش" }).click();
  await wallet.getByTestId("wallet-amount").fill("50");
  await wallet.getByRole("button", { name: "تأكيد الدفع بالمحفظة" }).click();
  await expect(pay.getByRole("alert")).toHaveText("اكتب رقم العملية");
  await wallet.getByTestId("wallet-reference").fill("TX-4471");
  await wallet.getByRole("button", { name: "تأكيد الدفع بالمحفظة" }).click();
  await expect(pay.getByTestId("change")).toHaveText("بقي على الطلب 30 ل.س");

  await pay.getByRole("button", { name: "نقداً", exact: true }).click();
  for (const digit of "50") await pay.getByRole("button", { name: digit, exact: true }).click();
  const before = pngs();
  await pay.getByRole("button", { name: "ادفع نقداً" }).click();
  await expect(pay.getByTestId("change")).toContainText("20 ل.س");
  await expect.poll(pngs, { timeout: 20_000 }).toBe(before + 1);
  await pay.getByRole("button", { name: "تم" }).click();
});

test("the X report shows the wallet, the coupon, and only the cash in the drawer", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await page.getByRole("link", { name: "التقارير" }).click();
  const report = page.getByTestId("report");
  await expect(report).toContainText("سيريتل كاش");
  await expect(report).toContainText("الكوبونات");
  await expect(report).toContainText(`${CODE} (1)`);
  await expect(report).toContainText(`كوبون ${CODE}`);
});

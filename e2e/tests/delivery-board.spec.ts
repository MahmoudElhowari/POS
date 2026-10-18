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
// A new driver each run, so the driver's totals start at zero.
const DRIVER = `سائق ${Date.now() % 100_000}`;

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
  expect((await request.post("/api/admin/drivers", { headers, data: { name: DRIVER } })).status()).toBe(201);
});

async function signIn(page: Page, pin: string) {
  await page.goto("/#/order");
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
}

/** A delivery of one can of cola (100) with a delivery fee, left to pay at the door. */
async function sendDelivery(page: Page, name: string, feePounds: number) {
  await page.getByRole("link", { name: "طلب جديد" }).click();
  await page.getByRole("button", { name: "توصيل", exact: true }).click();
  await page.getByLabel("اسم الزبون").fill(name);
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  const pay = page.getByRole("dialog", { name: "الدفع" });
  await pay.getByTestId("delivery-fee").fill(String(feePounds));
  await pay.getByRole("button", { name: "تطبيق" }).click();
  await expect(pay.getByTestId("due")).toContainText(`${100 + feePounds} ل.س`);
  await pay.getByRole("button", { name: "الدفع لاحقاً" }).click();
  await expect(pay).toBeHidden();
}

test("a cashier sends two orders out with a driver, takes the cash back, and the driver keeps the fees", async ({ page }) => {
  const suffix = Date.now() % 100_000;
  const first = `توصيل أ ${suffix}`;
  const second = `توصيل ب ${suffix}`;
  await signIn(page, CASHIER_PIN);
  await sendDelivery(page, first, 50);
  await sendDelivery(page, second, 30);

  await page.getByRole("link", { name: "التوصيل" }).click();
  const waiting = page.getByTestId("waiting");
  await waiting.getByTestId("board-order").filter({ hasText: first }).click();
  await waiting.getByTestId("board-order").filter({ hasText: second }).click();
  await page.getByTestId("send-out").getByRole("button", { name: DRIVER }).click();
  await page.getByRole("button", { name: "خرج للتوصيل (2)" }).click();
  await expect(page.getByRole("status")).toHaveText(`خرج للتوصيل مع ${DRIVER}: 2`);

  const out = page.getByTestId("out");
  const firstCard = out.getByTestId("board-order").filter({ hasText: first });
  await expect(firstCard).toContainText(DRIVER);
  await expect(firstCard).toContainText("150 ل.س");

  // First: the driver brings 200 for 150, so 50 change goes back.
  await firstCard.getByRole("button", { name: "تم التوصيل" }).click();
  const dialog = page.getByRole("dialog", { name: "تم التوصيل" });
  await expect(dialog.getByTestId("due")).toContainText("150 ل.س");
  await expect(dialog).toContainText("أجرة التوصيل يأخذها السائق");
  await dialog.getByLabel("المبلغ الذي سلّمه السائق (ل.س)").fill("200");
  const before = pngs();
  await dialog.getByRole("button", { name: "تم التوصيل واستلام المبلغ" }).click();
  await expect(page.getByRole("status")).toContainText("الباقي للسائق 50 ل.س");
  await expect.poll(pngs, { timeout: 20_000 }).toBe(before + 1);

  // Second: the customer wasn't home, so it comes back and goes out again.
  const secondCard = out.getByTestId("board-order").filter({ hasText: second });
  await secondCard.getByRole("button", { name: "أعاده السائق" }).click();
  await expect(waiting.getByTestId("board-order").filter({ hasText: second })).toBeVisible();
  await waiting.getByTestId("board-order").filter({ hasText: second }).click();
  await page.getByTestId("send-out").getByRole("button", { name: DRIVER }).click();
  await page.getByRole("button", { name: "خرج للتوصيل (1)" }).click();
  await out.getByTestId("board-order").filter({ hasText: second }).getByRole("button", { name: "تم التوصيل" }).click();
  await page.getByRole("dialog", { name: "تم التوصيل" }).getByRole("button", { name: "تم التوصيل واستلام المبلغ" }).click();

  await expect(page.getByTestId("delivered")).toContainText(first);
  await expect(page.getByTestId("delivered")).toContainText(second);
  // Collected 150 + 130 = 280; fees 50 + 30 = 80; hands in 200.
  const row = page.getByTestId("driver-summary").getByRole("row").filter({ hasText: DRIVER });
  await expect(row).toContainText("280");
  await expect(row).toContainText("80");
  await expect(row).toContainText("200");
});

test("the X report lists the driver and takes the fees out of the expected cash", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await page.getByRole("link", { name: "التقارير" }).click();
  const report = page.getByTestId("report");
  await expect(report).toContainText("السائقون");
  await expect(report).toContainText(DRIVER);
  await expect(report).toContainText("− أجرة السائقين");
});

import { expect, type Page, test } from "@playwright/test";

const ADMIN_PIN = process.env.E2E_ADMIN_PIN ?? "1234";
const CASHIER_PIN = "2468";
const MANAGER_PIN = "1357";
const CANS = "كولا · علبة";
const BOX = "علبة بيتزا وسط";
// A new name each run, since stock item names are unique.
const NEW_ITEM = `جبنة موزاريلا ${Date.now() % 100_000}`;

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

const row = (page: Page, name: string) => page.getByTestId("stock-row").filter({ has: page.getByRole("cell", { name, exact: true }) });

/** The level shown for a stock item, as a number in the unit the screen shows. */
async function level(page: Page, name: string) {
  const text = (await row(page, name).getByTestId("level").innerText()).trim();
  return Number(text.split(" ")[0]);
}

async function record(
  page: Page,
  name: string,
  action: "وارد" | "جرد" | "تالف",
  qty: string,
  extra?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>,
) {
  await row(page, name).getByRole("button", { name: "تسجيل" }).click();
  const dialog = page.getByRole("dialog", { name });
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await dialog.getByTestId("stock-qty").fill(qty);
  await extra?.(dialog);
  const save = { وارد: "تسجيل الوارد", جرد: "حفظ الجرد", تالف: "تسجيل التالف" }[action];
  await dialog.getByRole("button", { name: save }).click();
  await expect(dialog.getByRole("status")).toContainText("تم الحفظ");
  await dialog.getByRole("button", { name: "رجوع" }).click();
  await expect(dialog).toBeHidden();
}

test("a manager records a delivery, a sale takes cans and a box off, and waste and a count are recorded", async ({ page }) => {
  await signIn(page, MANAGER_PIN);
  await page.getByRole("link", { name: "المخزون" }).click();
  await expect(page.getByTestId("stock")).toContainText(CANS);
  // Setup is the admin's: a manager records but never sees the links or the new-item form.
  await expect(page.getByTestId("add-stock-item")).toHaveCount(0);

  const cans = await level(page, CANS);
  await record(page, CANS, "وارد", "48", async (dialog) => {
    await dialog.getByLabel("السعر المدفوع (ل.س، اختياري)").fill("4800");
    await dialog.getByLabel("المورّد (اختياري)").fill("موزع المشروبات");
  });
  await expect.poll(() => level(page, CANS)).toBe(cans + 48);
  const box = await level(page, BOX);
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  // A pickup Corn pizza (regular) with two cans of cola: 750 + 200.
  await signIn(page, CASHIER_PIN);
  await expect(page.getByRole("link", { name: "المخزون" })).toHaveCount(0);
  await page.getByRole("link", { name: "طلب جديد" }).click();
  await page.getByRole("button", { name: "استلام", exact: true }).click();
  await page.getByLabel("اسم الزبون").fill("زبون المخزون");
  await page.getByRole("button", { name: "المميزة" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "بيتزا ذرة" }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await expect(page.getByTestId("order-total")).toHaveText("950 ل.س");
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  const pay = page.getByRole("dialog", { name: "الدفع" });
  for (const digit of "1000") await pay.getByRole("button", { name: digit, exact: true }).click();
  await pay.getByRole("button", { name: "ادفع نقداً" }).click();
  await expect(pay.getByTestId("change")).toContainText("50 ل.س");
  await pay.getByRole("button", { name: "تم" }).click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  await signIn(page, MANAGER_PIN);
  await page.getByRole("link", { name: "المخزون" }).click();
  await expect.poll(() => level(page, CANS)).toBe(cans + 46);
  expect(await level(page, BOX)).toBe(box - 1);

  await record(page, CANS, "تالف", "2", (dialog) => dialog.getByLabel("السبب").fill("علب منفوخة"));
  await expect.poll(() => level(page, CANS)).toBe(cans + 44);
  await record(page, CANS, "جرد", "40");
  await expect.poll(() => level(page, CANS)).toBe(40);
  const difference = 40 - (cans + 44);
  await expect(row(page, CANS)).toContainText(`الفرق ${difference > 0 ? "+" : ""}${difference}`);

  await row(page, CANS).getByRole("button", { name: "تسجيل" }).click();
  const moves = page.getByRole("dialog", { name: CANS }).getByTestId("moves");
  for (const kind of ["جرد", "تالف", "بيع", "وارد"]) await expect(moves).toContainText(kind);
  await expect(moves).toContainText("موزع المشروبات");
});

test("the admin adds a stock item counted by the kilo", async ({ page }) => {
  await signIn(page, ADMIN_PIN);
  await page.getByRole("link", { name: "المخزون" }).click();
  const add = page.getByTestId("add-stock-item");
  await add.getByLabel("الاسم").fill(NEW_ITEM);
  await add.getByRole("button", { name: "بالكيلو" }).click();
  await add.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(add.getByRole("status")).toHaveText("تمت الإضافة");
  await record(page, NEW_ITEM, "وارد", "2.5");
  await expect(row(page, NEW_ITEM).getByTestId("level")).toHaveText("2.5 كغ");
  await row(page, NEW_ITEM).getByRole("button", { name: "تسجيل" }).click();
  await expect(page.getByRole("dialog", { name: NEW_ITEM }).getByTestId("stock-setup")).toBeVisible();
});

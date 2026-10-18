import { expect, type Page, test } from "@playwright/test";

const ADMIN_PIN = process.env.E2E_ADMIN_PIN ?? "1234";
const CASHIER_PIN = "2468";

// The admin adds a cashier once; later runs find the PIN already taken.
test.beforeAll(async ({ request }) => {
  const { token } = await (await request.post("/api/auth/pin", { data: { pin: ADMIN_PIN } })).json();
  const res = await request.post("/api/admin/staff", {
    headers: { authorization: `Bearer ${token}` },
    data: { name: "كاشير الاختبار", role: "cashier", pin: CASHIER_PIN },
  });
  expect([201, 409]).toContain(res.status());
});

async function signInAsCashier(page: Page) {
  await page.goto("/#/order");
  for (const digit of CASHIER_PIN) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("كاشير الاختبار");
}

test("a cashier cannot open the menu admin", async ({ page }) => {
  await signInAsCashier(page);
  await expect(page.getByRole("link", { name: "القائمة" })).toHaveCount(0);
  await page.goto("/#/menu");
  await expect(page.getByText("هذه الشاشة للمدير فقط")).toBeVisible();
});

test("a cashier builds a delivery order, holds it, recalls it and sends it", async ({ page }) => {
  await signInAsCashier(page);
  await page.getByRole("button", { name: "توصيل" }).click();
  await page.getByLabel("اسم الزبون").fill("زبون الاختبار");
  await page.getByLabel("رقم الهاتف (اختياري)").fill("0999 000 111");
  await page.getByLabel("المنطقة (اختياري)").fill("المزة");

  // ½ Corn + ½ Sultan Large, without sauce: priced as Sultan Large (2,200).
  await page.getByRole("button", { name: "المميزة" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "بيتزا ذرة" }).click();
  let sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /كبير/ }).click();
  await sheet.getByRole("button", { name: "اختر النصف الثاني" }).click();
  await sheet.getByTestId("half-picker").getByRole("button", { name: "بيتزا السلطان" }).click();
  await sheet.getByRole("button", { name: "صوص", exact: true }).click();
  await expect(sheet.getByTestId("sheet-price")).toHaveText("2,200 ل.س");
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();

  // Corn Regular with a cheese stuffed crust: 750 + 200.
  await page.getByTestId("menu-item").filter({ hasText: "بيتزا ذرة" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /محشية الأطراف/ }).click();
  await expect(sheet.getByTestId("sheet-price")).toHaveText("950 ل.س");
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();

  // A can of soda: 100.
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /علبة/ }).click();
  await sheet.getByRole("button", { name: "إضافة إلى الطلب" }).click();

  await expect(page.getByTestId("order-lines")).toContainText("نص بيتزا ذرة / نص بيتزا السلطان");
  await expect(page.getByTestId("order-lines")).toContainText("بدون صوص");
  await expect(page.getByTestId("order-total")).toHaveText("3,250 ل.س");

  await page.getByRole("button", { name: "تعليق" }).click();
  await expect(page.getByRole("status")).toContainText("تم تعليق طلب زبون الاختبار");
  await expect(page.getByTestId("order-total")).toHaveText("0 ل.س");

  await page.getByRole("button", { name: /المعلّقة/ }).click();
  await page.getByTestId("held-order").filter({ hasText: "زبون الاختبار" }).first().click();
  await expect(page.getByTestId("order-total")).toHaveText("3,250 ل.س");

  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  // The pay dialog opens after sending, and its amount box is a status too, so pick the notice by its text.
  await expect(page.getByRole("status").filter({ hasText: "تم إرسال الطلب" })).toContainText(/تم إرسال الطلب رقم \d+ · 3,250 ل\.س/);
});

test("an order needs a customer name", async ({ page }) => {
  await signInAsCashier(page);
  await page.getByRole("button", { name: "المشروبات" }).click();
  await page.getByTestId("menu-item").filter({ hasText: "كولا" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إضافة إلى الطلب" }).click();
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  await expect(page.getByRole("status")).toHaveText("اكتب اسم الزبون");
});

test("an item marked out of stock disappears from an open order screen", async ({ page, request }) => {
  await signInAsCashier(page);
  await page.getByRole("button", { name: "المشروبات" }).click();
  const water = page.getByTestId("menu-item").filter({ hasText: "مياه" });
  await expect(water).toBeVisible();

  const { token } = await (await request.post("/api/auth/pin", { data: { pin: ADMIN_PIN } })).json();
  const headers = { authorization: `Bearer ${token}` };
  const menu = await (await request.get("/api/admin/menu", { headers })).json();
  const item = menu.categories.flatMap((c: { items: { id: string; nameEn: string }[] }) => c.items).find((i: { nameEn: string }) => i.nameEn === "Water");
  try {
    await request.patch(`/api/admin/items/${item.id}`, { headers, data: { available: false } });
    await expect(water).toHaveCount(0); // no reload: the screen hears about it live
  } finally {
    await request.patch(`/api/admin/items/${item.id}`, { headers, data: { available: true } });
  }
  await expect(water).toBeVisible();
});

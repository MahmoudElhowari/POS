import { expect, type Page, test } from "@playwright/test";

// Uses the admin created from ADMIN_INITIAL_PIN in .env.example.
const PIN = process.env.E2E_ADMIN_PIN ?? "1234";

async function signIn(page: Page) {
  await page.goto("/#/menu");
  for (const digit of PIN) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("button", { name: "الأصناف" })).toBeVisible();
}

test("a wrong PIN is refused", async ({ page }) => {
  await page.goto("/#/menu");
  for (const digit of "0000") await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByText("الرمز غير صحيح")).toBeVisible();
});

test("an admin prices Margherita and it reaches the order menu", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "الكلاسيكية" }).click();
  await page.getByTestId("item-card").filter({ hasText: "بيتزا مرغريتا" }).first().click();

  const dialog = page.getByRole("dialog");
  const price = 1600 + Math.floor(Math.random() * 100);
  await dialog.getByLabel("وسط ل.س").fill("800");
  await dialog.getByLabel("كبير ل.س").fill(String(price));
  await dialog.getByRole("button", { name: "حفظ" }).click();
  await expect(dialog).toBeHidden();

  const menu = await (await request.get("/api/menu")).json();
  const margherita = menu.categories.flatMap((c: { items: unknown[] }) => c.items).find((i: { nameEn: string }) => i.nameEn === "Margherita Pizza");
  expect(margherita.sizes.find((s: { sizeKey: string }) => s.sizeKey === "large").priceCents).toBe(price * 100);
});

test("a bulk change shows a preview before anything changes", async ({ page, request }) => {
  await signIn(page);
  const before = await (await request.get("/api/menu")).json();
  await page.getByRole("button", { name: "تعديل الأسعار" }).click();
  await page.getByRole("textbox").fill("10");
  await page.getByRole("button", { name: "معاينة" }).click();
  await expect(page.getByTestId("bulk-preview")).toContainText("بيتزا السلطان");
  // Preview only: nothing changed yet.
  expect(await (await request.get("/api/menu")).json()).toEqual(before);
});

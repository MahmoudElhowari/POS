import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const outputDir = fileURLToPath(new URL("../../printer-output/", import.meta.url));
const pngs = () => {
  try {
    return readdirSync(outputDir).filter((f) => f.endsWith(".png"));
  } catch {
    return [];
  }
};

test("prints a test ticket from the Arabic screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "رومانتيكا بيتزا" })).toBeVisible();
  await expect(page.getByTestId("printer-status")).toContainText("متصلة");

  const before = pngs().length;
  await page.getByRole("button", { name: "اطبع تذكرة تجريبية" }).click();
  await expect(page.getByTestId("job-status")).toContainText("تمت الطباعة", { timeout: 20_000 });
  await expect.poll(() => pngs().length).toBe(before + 1);
});

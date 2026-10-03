import { expect, test } from "@playwright/test";

test("every page renders the disclosure footer", async ({ page }) => {
  for (const path of ["/", "/launch", "/btc", "/ledger", "/docs"]) {
    await page.goto(path);
    await expect(page.getByText("not affiliated with pump.fun")).toBeVisible();
  }
});

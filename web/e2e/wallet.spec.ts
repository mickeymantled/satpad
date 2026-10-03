import { expect, test } from "@playwright/test";

test("the dev burner wallet connects from the header", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect(page.getByTestId("wallet-button")).toContainText(/\w{4}\.\.\w{4}|\w{4}…\w{4}/, { timeout: 15_000 });
});

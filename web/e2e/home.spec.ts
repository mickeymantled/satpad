import { expect, test } from "@playwright/test";

test("home renders hero, stats, ticker and the fork's coins; filters and sorts change the grid", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.getByTestId("stats-bar")).toContainText("Coins launched");
  await expect(page.getByTestId("live-ticker")).toBeVisible();
  const cards = page.getByTestId("coin-card");
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(Number(process.env["E2E_MIN_COINS"] ?? 3)); // fork:seed makes 3 in CI, 10 in the soak; launches add more
  await expect(cards.first()).toContainText("BTC");
  await expect(cards.first()).toContainText("sats");
  // stage filter: Dust (all 10 soak coins are below 10 buys? no — many are mining); counts must be ≤ 10 and consistent
  await page.getByTestId("coin-filters").getByRole("link", { name: "Mining" }).click();
  await expect(page).toHaveURL(/stage=mining/);
  const mining = await page.getByTestId("coin-card").count();
  for (let i = 0; i < mining; i++) await expect(page.getByTestId("coin-card").nth(i)).toHaveAttribute("data-stage", "mining");
  await page.getByTestId("coin-filters").getByRole("link", { name: "Pays holders" }).click();
  await expect(page).toHaveURL(/pays_holders=true/);
  await expect(page.getByTestId("coin-card").first()).toContainText("pays holders");
  await page.getByTestId("coin-filters").getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("coin-card")).toHaveCount(total);
  await page.getByLabel("Sort").selectOption("newest");
  await expect(page).toHaveURL(/sort=newest/);
  await expect(page.getByTestId("coin-card")).toHaveCount(total);
  // ticker connects to WS /live and shows a trade from the running soak trader within a few seconds
  await expect(page.getByTestId("live-ticker")).toHaveAttribute("data-connected", "true", { timeout: 15_000 });
  await expect(page.getByTestId("live-ticker")).toContainText(/▲|▼/, { timeout: 20_000 });
});

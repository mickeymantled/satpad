import { expect, test } from "@playwright/test";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

// M6: a graduated coin trades on its PumpSwap pool from the coin page. Runs against the M6 stack (E2E_BASE_URL=:3001,
// API :8084, fork :8999); skipped elsewhere because the soak fork has no graduated coin.
const RPC = process.env["E2E_RPC_URL"] ?? "http://127.0.0.1:8899";
const API = process.env["E2E_API_URL"] ?? "http://127.0.0.1:8083";

test("buy and sell a graduated coin on its PumpSwap pool", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  const list = (await (await fetch(`${API}/coins?stage=block&limit=5`)).json()) as { coins: { mint: string; symbol: string | null }[] };
  const details = await Promise.all(list.coins.map(async (c) => (await (await fetch(`${API}/coins/${c.mint}`)).json()) as { mint: string; treasuryOnly: boolean }));
  const coin = details.find((c) => !c.treasuryOnly) ?? details[0];
  test.skip(!coin, "no graduated coin on this stack");
  const nav = await page.goto(`/coin/${coin!.mint}`);
  try {
    await expect(page.getByTestId("trade-panel")).toHaveAttribute("data-venue", "pool", { timeout: 60_000 }); // first load compiles the route on a dev server
  } catch (e) { throw new Error(`${(e as Error).message}\nnav: ${nav?.status()} ${page.url()}\nconsole: ${consoleErrors.join(" | ")}\nbody: ${(await page.locator("body").innerText()).slice(0, 300)}`); }
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect.poll(async () => page.getByTestId("wallet-button").getAttribute("data-pubkey"), { timeout: 15_000 }).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const pubkey = new PublicKey((await page.getByTestId("wallet-button").getAttribute("data-pubkey"))!);
  const conn = new Connection(RPC, "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL), "confirmed");
  await expect(page.getByTestId("swap-panel")).toHaveAttribute("data-kind", "dev-faucet", { timeout: 20_000 });
  await page.getByTestId("swap-sol").fill("0.5");
  await page.getByTestId("swap-submit").click();
  await expect(page.getByTestId("trade-balance")).toContainText("0.0005 BTC", { timeout: 60_000 });
  // buy 0.0001 BTC on the pool
  await page.getByTestId("trade-amount").fill("0.0001");
  await expect(page.getByTestId("trade-quote")).toContainText("You receive");
  await page.getByTestId("trade-submit").click();
  const outcome = await Promise.race([page.getByTestId("tx-confirm").waitFor({ timeout: 30_000 }).then(() => "preview" as const), page.getByTestId("tx-error").waitFor({ timeout: 30_000 }).then(() => "error" as const)]);
  if (outcome === "error") throw new Error(`pool buy failed: ${await page.getByTestId("tx-error").textContent()}\n${await page.getByTestId("tx-logs").textContent().catch(() => "")}`);
  await expect(page.getByTestId("tx-preview")).toContainText("(pool)");
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("tx-signature")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("trade-balance")).not.toContainText("0.0005 BTC", { timeout: 20_000 });
  // sell 1000 tokens back
  await page.getByTestId("side-sell").click();
  await page.getByTestId("trade-amount").fill("1000");
  await expect(page.getByTestId("trade-quote")).toContainText("You receive");
  await page.getByTestId("trade-submit").click();
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("tx-signature")).toBeVisible({ timeout: 60_000 });
  // the indexer lists both as pool trades
  await expect.poll(async () => { await page.reload(); await page.getByTestId("tab-trades").click(); return page.getByTestId("coin-tabs").textContent(); }, { timeout: 60_000, intervals: [3000] }).toMatch(/sell[\s\S]*buy|buy[\s\S]*sell/);
});

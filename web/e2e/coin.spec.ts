import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env["E2E_RPC_URL"] ?? "http://127.0.0.1:8899";

/** Funds a wallet on the fork with SOL and wBTC (fork keys; never exists outside the fork). */
async function fund(pubkey: string, satsAmount: bigint) {
  const { fundSol, fundWbtc } = await import(path.join(ROOT, "scripts/lib/fork.ts"));
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(ROOT, "scripts/fork-keys/seed.json"), "utf8")).wallets.deployer.secret));
  await fundSol(conn, [new PublicKey(pubkey)], 2);
  await fundWbtc(conn, payer, new PublicKey(pubkey), satsAmount);
  void LAMPORTS_PER_SOL;
}

test("coin page: chart, tabs, links; burner wallet buys then sells on the fork", async ({ page }) => {
  await page.goto("/");
  const mint = await page.getByTestId("coin-card").first().getAttribute("data-mint");
  await page.goto(`/coin/${mint}`);
  await expect(page.getByTestId("coin-name")).toBeVisible();
  await expect(page.getByTestId("price-chart")).toBeVisible();
  await expect(page.getByTestId("fee-accounts")).toContainText("CoinFee");
  await page.getByTestId("tab-holders").click();
  await expect(page.getByTestId("coin-tabs")).not.toContainText("No holders yet");
  await page.getByTestId("tab-trades").click();

  // connect burner, fund it from Node, then trade
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect.poll(async () => page.getByTestId("wallet-button").getAttribute("data-pubkey"), { timeout: 15_000 }).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const pubkey = (await page.getByTestId("wallet-button").getAttribute("data-pubkey"))!;
  await fund(pubkey, 200_000n); // 0.002 wBTC
  await expect(page.getByTestId("trade-panel")).toContainText("0.002 BTC", { timeout: 20_000 });

  await page.getByTestId("trade-amount").fill("0.0005");
  await expect(page.getByTestId("trade-quote")).toContainText("You receive");
  await page.getByTestId("trade-submit").click();
  await expect(page.getByTestId("tx-preview")).toContainText("pump.fun");
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("tx-signature")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("trade-panel")).not.toContainText("0.002 BTC", { timeout: 20_000 });

  await page.getByTestId("side-sell").click();
  await page.getByTestId("trade-amount").fill("1000");
  await expect(page.getByTestId("trade-quote")).toContainText("You receive");
  await page.getByTestId("trade-submit").click();
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("tx-signature")).toBeVisible({ timeout: 60_000 });
});

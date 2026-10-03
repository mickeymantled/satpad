import { expect, test } from "@playwright/test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const RPC = process.env["E2E_RPC_URL"] ?? "http://127.0.0.1:8899";

test("a wallet with only SOL swaps via the dev faucet, then buys a coin", async ({ page }) => {
  await page.goto("/");
  const mint = await page.getByTestId("coin-card").first().getAttribute("data-mint");
  await page.goto(`/coin/${mint}`);
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect.poll(async () => page.getByTestId("wallet-button").getAttribute("data-pubkey"), { timeout: 15_000 }).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const pubkey = new PublicKey((await page.getByTestId("wallet-button").getAttribute("data-pubkey"))!);
  const conn = new Connection(RPC, "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL), "confirmed"); // SOL only
  void Keypair;
  await expect(page.getByTestId("swap-panel")).toHaveAttribute("data-kind", "dev-faucet", { timeout: 20_000 });
  await page.getByTestId("swap-sol").fill("0.5");
  await expect(page.getByTestId("swap-quote")).toContainText("50,000 sats");
  await page.getByTestId("swap-submit").click();
  await expect(page.getByTestId("trade-balance")).toContainText("0.0005 BTC", { timeout: 60_000 }); // the swap quote also says 0.0005 BTC; wait on the balance line
  await expect(page.getByTestId("swap-panel")).toBeHidden();
  await page.getByTestId("trade-amount").fill("0.0002");
  await page.getByTestId("trade-submit").click();
  const outcome = await Promise.race([
    page.getByTestId("tx-confirm").waitFor({ timeout: 30_000 }).then(() => "preview" as const),
    page.getByTestId("tx-error").waitFor({ timeout: 30_000 }).then(() => "error" as const),
  ]);
  if (outcome === "error") {
    const logs = await page.getByTestId("tx-logs").textContent().catch(() => "");
    throw new Error(`buy failed: ${await page.getByTestId("tx-error").textContent()}\n${logs}`);
  }
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("tx-signature")).toBeVisible({ timeout: 60_000 });
});

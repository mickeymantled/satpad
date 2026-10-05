import { expect, test } from "@playwright/test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const RPC = process.env["E2E_RPC_URL"] ?? "http://127.0.0.1:8899";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// M5 definition of done: a wallet with only SOL launches a coin (dev swap → launch with first buy) and it appears on / and /coin/:mint.
test("a SOL-only burner wallet launches a coin with a first buy", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/launch");
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect.poll(async () => page.getByTestId("wallet-button").getAttribute("data-pubkey"), { timeout: 15_000 }).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const pubkey = new PublicKey((await page.getByTestId("wallet-button").getAttribute("data-pubkey"))!);
  const conn = new Connection(RPC, "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL), "confirmed"); // SOL only

  const name = `E2E ${Date.now().toString(36)}`;
  await page.getByTestId("launch-name").fill(name);
  await page.getByTestId("launch-symbol").fill("E2E");
  await page.getByTestId("launch-description").fill("made by playwright");
  await page.getByTestId("launch-image").setInputFiles({ name: "coin.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("launch-payee-holders").check();
  await page.getByTestId("launch-first-buy").fill("0.0001");
  await expect(page.getByTestId("launch-quote")).toContainText("tokens", { timeout: 20_000 });

  // No BTC yet → the swap panel appears inside the form; swap 0.3 SOL through the dev faucet (D17).
  await expect(page.getByTestId("swap-panel")).toHaveAttribute("data-kind", "dev-faucet", { timeout: 20_000 });
  await page.getByTestId("swap-sol").fill("0.3");
  await page.getByTestId("swap-submit").click();
  await expect(page.getByTestId("launch-balance")).toContainText("0.0003 BTC", { timeout: 60_000 });
  await expect(page.getByTestId("swap-panel")).toBeHidden();

  await page.getByTestId("launch-submit").click();
  const outcome = await Promise.race([
    page.getByTestId("tx-confirm").waitFor({ timeout: 60_000 }).then(() => "preview" as const),
    page.getByTestId("tx-error").waitFor({ timeout: 60_000 }).then(() => "error" as const),
  ]);
  if (outcome === "error") throw new Error(`launch failed: ${await page.getByTestId("tx-error").textContent()}`);
  // SPEC: every instruction listed before the wallet prompt — CU limit, CU price, create_v2, declare_coin, coin ATA, buy_v2.
  await expect(page.getByTestId("tx-preview").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("tx-preview")).toContainText("satpad_vault");
  await page.getByTestId("tx-confirm").click();
  await expect(page.getByTestId("launch-done")).toBeVisible({ timeout: 90_000 });
  const mint = (await page.getByTestId("launch-done").getAttribute("data-mint"))!;

  // The indexer picks it up; the form navigates to the coin page, which shows the name and the first buy.
  await page.waitForURL(`**/coin/${mint}`, { timeout: 150_000 });
  await expect(page.getByTestId("coin-name")).toContainText(name);
  await expect(page.getByTestId("rewards-badge").or(page.getByText(/pays holders/i)).first()).toBeVisible();
  // The first buy inside the launch transaction is indexed as a trade (pump events decoded from the self-CPI, not the truncated logs).
  await page.getByTestId("tab-trades").click();
  await expect(page.getByTestId("coin-tabs")).toContainText("buy");
  await expect(page.getByTestId("coin-tabs")).not.toContainText("No trades yet");
  await page.goto("/?sort=newest");
  await expect(page.locator(`[data-testid="coin-card"][data-mint="${mint}"]`)).toBeVisible({ timeout: 30_000 });
});

// Worst case for the 1232-byte limit: 32-byte name, 10-char symbol, Wallet payee (one more inline account), first buy.
// Over the lookup table this measured 1283 bytes on the fork, so the planner sends the first buy as a second transaction.
test("a launch at the size limit splits the first buy into a second transaction", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/launch");
  await page.getByTestId("wallet-button").getByRole("button").click();
  await page.getByRole("button", { name: /Burner/ }).click();
  await expect.poll(async () => page.getByTestId("wallet-button").getAttribute("data-pubkey"), { timeout: 15_000 }).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const pubkey = new PublicKey((await page.getByTestId("wallet-button").getAttribute("data-pubkey"))!);
  const conn = new Connection(RPC, "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL), "confirmed");
  const name = `Thirty two byte name ${Date.now().toString(36).padStart(11, "x")}`.slice(0, 32);
  expect(Buffer.byteLength(name)).toBe(32);
  await page.getByTestId("launch-name").fill(name);
  await page.getByTestId("launch-symbol").fill("LONGSYMBOL");
  await page.getByTestId("launch-image").setInputFiles({ name: "coin.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("launch-payee-wallet").check();
  await page.getByTestId("launch-payee-address").fill(Keypair.generate().publicKey.toBase58());
  await page.getByTestId("launch-first-buy").fill("0.0001");
  await expect(page.getByTestId("swap-panel")).toHaveAttribute("data-kind", "dev-faucet", { timeout: 20_000 });
  await page.getByTestId("swap-sol").fill("0.3");
  await page.getByTestId("swap-submit").click();
  await expect(page.getByTestId("launch-balance")).toContainText("0.0003 BTC", { timeout: 60_000 });
  await page.getByTestId("launch-submit").click();
  // first preview: the launch itself
  await expect(page.getByTestId("tx-confirm")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("launch-plan")).toHaveAttribute("data-mode", /split|single-no-fee/);
  const mode = await page.getByTestId("launch-plan").getAttribute("data-mode");
  // D20 condition: the preview itself must say what this transaction is — atomic launch, buy as a second transaction.
  await expect(page.getByTestId("tx-note")).toContainText(mode === "split" ? /SECOND transaction/ : /one atomic transaction/);
  await page.getByTestId("tx-confirm").click();
  if (mode === "split") {
    await expect(page.getByTestId("launch-done")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("tx-preview")).toContainText("First buy", { timeout: 60_000 }); // second preview
    await expect(page.getByTestId("tx-note")).toContainText("Second transaction");
    await expect(page.getByTestId("tx-preview").locator("li")).toHaveCount(4); // CU limit, CU price, coin ATA, buy_v2
    await page.getByTestId("tx-confirm").click();
  }
  const mint = (await page.getByTestId("launch-done").getAttribute("data-mint"))!;
  await page.waitForURL(`**/coin/${mint}`, { timeout: 150_000 });
  await expect(page.getByTestId("coin-name")).toContainText(name);
  // The second transaction is indexed a poll or two after the launch; the page is server-rendered, so re-check with reloads.
  await expect.poll(async () => {
    await page.reload();
    await page.getByTestId("tab-trades").click();
    return page.getByTestId("coin-tabs").textContent();
  }, { timeout: 90_000, intervals: [3000] }).toContain("buy");
});

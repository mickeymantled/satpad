// Milestone 1 definition of done (DECISIONS D1): create a coin on the local mainnet fork with
// quote_mint = BTC_QUOTE_MINT and buy it once with buy_v2 — through @satpad/sdk, with the pump.fun `creator`
// set to the coin's CoinFee PDA exactly as the launch flow will (DECISIONS D4).
//
// Run:  scripts/local-fork.sh --detach && pnpm fork:m1 [--dry-run]
// Env:  LOCAL_RPC_URL (default http://127.0.0.1:8899)
// --dry-run builds and simulates every transaction but sends nothing.
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import {
  BTC_QUOTE_MINT,
  BTC_QUOTE_TOKEN_PROGRAM,
  COIN_TOKEN_PROGRAM,
  DEFAULT_CREATOR_FEE_BPS,
  buildBuyV2,
  buildCreateV2,
  coinAccounts,
  coinFeePda,
  defaultFeeRecipients,
  quoteSatsForTokens,
  sats,
  toUi,
} from "@satpad/sdk";

const DRY = process.argv.includes("--dry-run");
const RPC = process.env["LOCAL_RPC_URL"] ?? "http://127.0.0.1:8899";
const FUND_SATS = 1_000_000n; // 0.01 wBTC minted to the test user on the fork
const BUY_TOKENS = 1_000_000_000n; // 1000 tokens (6 dec)

async function send(conn: Connection, label: string, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`${label} simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
  console.log(`${label}: simulated ok, ${sim.value.unitsConsumed} CU`);
  if (DRY) return "(dry-run)";
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log(`${label}: ${sig}`);
  return sig;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  if (DRY) console.log("dry-run: nothing will be sent");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync("scripts/fork-keys/wbtc-authority.json", "utf8"))));
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const [coinFee] = coinFeePda(mint.publicKey);

  // Fork-only setup: airdrop SOL and mint test wBTC. (Airdrops are real even in dry-run; they are fork-local.)
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL), "confirmed");
  const userWbtc = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, user.publicKey, false, BTC_QUOTE_TOKEN_PROGRAM);
  await send(conn, "fund wBTC", [
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, userWbtc, user.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM),
    createMintToInstruction(BTC_QUOTE_MINT, userWbtc, authority.publicKey, FUND_SATS, [], BTC_QUOTE_TOKEN_PROGRAM),
  ], [user, authority]);

  // 1. create_v2 via the SDK: creator = CoinFee PDA (non-signing), quote pinned to wBTC, fee 100 bps.
  const createIx = await buildCreateV2({
    mint: mint.publicKey, name: "Satpad M1", symbol: "SPM1", uri: "https://satpad.invalid/m1.json",
    creator: coinFee, user: user.publicKey,
  });
  const createSig = await send(conn, "create_v2", [createIx], [user, mint]);
  if (DRY) { console.log("dry-run: skipping buy (curve does not exist)"); return; }

  // 2. Quote the buy with the curve math, then buy_v2 with 5% slippage headroom.
  const online = new OnlinePumpSdk(conn);
  const [global, feeConfig, quoteControl] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl()]);
  const curveInfo = await conn.getAccountInfo(bondingCurvePda(mint.publicKey), "confirmed");
  if (!curveInfo) throw new Error("bonding curve not found after create");
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  const expectedSats = quoteSatsForTokens({ global, feeConfig, mintSupply: BigInt(curve.tokenTotalSupply.toString()), bondingCurve: curve, quoteControl }, BUY_TOKENS);
  const maxQuoteIn = sats((expectedSats * 105n) / 100n + 1n);
  console.log(`quote: ${BUY_TOKENS} tokens ≈ ${expectedSats} sats (${toUi(expectedSats)} BTC); cap ${maxQuoteIn}`);
  const buyIxs = await buildBuyV2({ user: user.publicKey, mint: mint.publicKey, creator: curve.creator, recipients: defaultFeeRecipients(global), tokenAmount: BUY_TOKENS, maxQuoteIn });
  const buySig = await send(conn, "buy_v2", buyIxs, [user]);

  // 3. Verify on chain.
  const after = PUMP_SDK.decodeBondingCurve((await conn.getAccountInfo(bondingCurvePda(mint.publicKey), "confirmed"))!);
  const tokens = (await getAccount(conn, getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, true, COIN_TOKEN_PROGRAM), "confirmed", COIN_TOKEN_PROGRAM)).amount;
  const spent = FUND_SATS - (await getAccount(conn, userWbtc, "confirmed", BTC_QUOTE_TOKEN_PROGRAM)).amount;
  const vaultAta = coinAccounts(mint.publicKey, coinFee).creatorVaultQuoteAta;
  const creatorFeeAccrued = await getAccount(conn, vaultAta, "confirmed", BTC_QUOTE_TOKEN_PROGRAM).then((a) => a.amount).catch(() => 0n);
  const result = {
    rpc: RPC, mint: mint.publicKey.toBase58(), coinFeePda: coinFee.toBase58(), createSig, buySig,
    curve: { quoteMint: after.quoteMint.toBase58(), creator: after.creator.toBase58(), creatorFeeBps: after.creatorFeeBps.toString(), virtualQuoteReserves: after.virtualQuoteReserves.toString(), realQuoteReserves: after.realQuoteReserves.toString() },
    userTokens: tokens.toString(), satsSpent: spent.toString(), satsQuoted: expectedSats.toString(), creatorFeeAccruedSats: creatorFeeAccrued.toString(),
  };
  console.log(JSON.stringify(result, null, 2));
  const checks: [string, boolean][] = [
    ["quote_mint == BTC_QUOTE_MINT", after.quoteMint.equals(BTC_QUOTE_MINT)],
    ["creator == CoinFee PDA (never signed)", after.creator.equals(coinFee)],
    [`creator_fee_bps == ${DEFAULT_CREATOR_FEE_BPS}`, after.creatorFeeBps.toString() === String(DEFAULT_CREATOR_FEE_BPS)],
    ["received the requested tokens", tokens === BUY_TOKENS],
    ["paid at most the cap", spent <= maxQuoteIn],
    ["paid exactly the quote", spent === expectedSats],
    ["creator fee accrued in the CoinFee creator_vault ATA", creatorFeeAccrued > 0n],
  ];
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? "PASS" : "FAIL"} ${name}`); ok &&= pass; }
  if (!ok) throw new Error("M1 definition of done NOT met");
  console.log("M1 definition of done: met");
}
main().catch((e) => { console.error(e); process.exit(1); });

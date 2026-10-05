// M6 task 2 evidence (VERIFIED V18): trade on a graduated coin's PumpSwap pool through the SDK wrappers — buy, sell,
// two-sided deposit with the minted LP burned in the same transaction (LP mint supply net zero), and
// collect_coin_creator_fee into the CoinFee PDA's wBTC ATA. Prototype of the keeper's LP and collect legs.
// Usage: LOCAL_RPC_URL=http://127.0.0.1:8999 FORK_KEYS_DIR=scripts/fork-keys-m6 npx tsx scripts/fork-amm-trade.ts [--mint <mint>] [--dry-run] [--no-collect]
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createBurnInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, ammDepositForSats, ammLiquidityState, ammQuoteSatsForSell, ammQuoteTokensForSats, ammSwapState, buildAmmBuy, buildAmmCollectCreatorFee, buildAmmDeposit, buildAmmSell, coinFeePda, LP_TOKEN_PROGRAM, lpMintOf, poolForMint } from "@satpad/sdk";
import { KEYS_DIR, RPC, ata, fundWbtc, send } from "./lib/fork";
import { DRY_RUN, arg } from "./lib/cli";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seed = JSON.parse(readFileSync(`${KEYS_DIR}/seed.json`, "utf8")) as { wallets: Record<string, { secret: number[] }>; coins: { mint: string }[] };
  const payer = Keypair.fromSecretKey(Uint8Array.from(seed.wallets["deployer"]!.secret));
  const mint = new PublicKey(arg("mint") ?? seed.coins[0]!.mint);
  const pool = poolForMint(mint), [coinFee] = coinFeePda(mint);
  let state = await ammSwapState(conn, pool, payer.publicKey);
  const lpMint = lpMintOf(state.pool);
  const lpSupply = async () => (await getMint(conn, lpMint, "confirmed", LP_TOKEN_PROGRAM)).supply;
  const bal = async (owner: PublicKey, m: PublicKey, prog: PublicKey) => getAccount(conn, getAssociatedTokenAddressSync(m, owner, true, prog), "confirmed", prog).then((a) => a.amount).catch(() => 0n);
  const out: Record<string, unknown> = { rpc: RPC, mint: mint.toBase58(), pool: pool.toBase58(), lpMint: lpMint.toBase58() };

  out["reservesBefore"] = { base: state.poolBaseAmount.toString(), quote: state.poolQuoteAmount.toString(), lpSupply: (await lpSupply()).toString() };
  const buySats = 1_000_000n; // 0.01 BTC
  const q = ammQuoteTokensForSats(state, buySats, 1);
  out["buyQuote"] = { sats: buySats.toString(), tokens: q.tokens.toString(), maxQuoteIn: q.maxQuoteIn.toString() };
  if (DRY_RUN) { console.log(JSON.stringify(out, null, 2)); console.log("(dry-run) nothing sent"); return; }

  await fundWbtc(conn, payer, payer.publicKey, q.maxQuoteIn + 100_000n);
  const tokBefore = await bal(payer.publicKey, mint, COIN_TOKEN_PROGRAM);
  out["buySig"] = await send(conn, await buildAmmBuy(state, q.tokens, q.maxQuoteIn), [payer], [], 400_000);
  const bought = (await bal(payer.publicKey, mint, COIN_TOKEN_PROGRAM)) - tokBefore;
  out["buyReceivedTokens"] = bought.toString();
  if (bought !== q.tokens) throw new Error(`buy delivered ${bought}, quoted ${q.tokens}`);

  state = await ammSwapState(conn, pool, payer.publicKey);
  const sellTokens = bought / 4n;
  const sq = ammQuoteSatsForSell(state, sellTokens, 1);
  const wbBefore = await bal(payer.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM);
  out["sellSig"] = await send(conn, await buildAmmSell(state, sellTokens, sq.minQuoteOut), [payer], [], 400_000);
  const got = (await bal(payer.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM)) - wbBefore;
  out["sell"] = { tokens: sellTokens.toString(), quotedSats: sq.sats.toString(), receivedSats: got.toString(), minQuoteOut: sq.minQuoteOut.toString() };
  if (got < sq.minQuoteOut) throw new Error("sell returned less than minQuoteOut");

  // Reserve leg: deposit 50,000 sats + matching tokens, burn exactly the LP minted — one transaction.
  const ls = await ammLiquidityState(conn, pool, payer.publicKey);
  const d = ammDepositForSats(ls, 50_000n, 1);
  const supplyBefore = await lpSupply();
  const lpAta = getAssociatedTokenAddressSync(lpMint, payer.publicKey, true, LP_TOKEN_PROGRAM);
  const ixs = [...(await buildAmmDeposit(ls, d.lpTokens, d.maxBase, d.maxQuote)), createBurnInstruction(lpAta, lpMint, payer.publicKey, d.lpTokens, [], LP_TOKEN_PROGRAM)];
  out["depositBurnSig"] = await send(conn, ixs, [payer], [], 400_000);
  const supplyAfter = await lpSupply();
  const lpLeft = await bal(payer.publicKey, lpMint, LP_TOKEN_PROGRAM);
  const after = await ammSwapState(conn, pool, payer.publicKey);
  out["deposit"] = { lpTokens: d.lpTokens.toString(), base: d.base.toString(), maxBase: d.maxBase.toString(), maxQuote: d.maxQuote.toString(), lpSupplyBefore: supplyBefore.toString(), lpSupplyAfter: supplyAfter.toString(), lpLeftInWallet: lpLeft.toString(), reservesAfter: { base: after.poolBaseAmount.toString(), quote: after.poolQuoteAmount.toString() } };
  if (supplyAfter !== supplyBefore) throw new Error(`LP supply changed: ${supplyBefore} → ${supplyAfter}`);
  if (lpLeft !== 0n) throw new Error(`LP tokens left in wallet: ${lpLeft}`);

  // Creator fees from the buy/sell sit in the AMM creator vault of CoinFee; collect them into CoinFee's wBTC ATA
  // (--no-collect leaves them for the keeper's settle loop to collect).
  if (process.argv.includes("--no-collect")) { console.log(JSON.stringify(out, null, 2)); return; }
  const feeBefore = await bal(coinFee, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM);
  out["collectSig"] = await send(conn, await buildAmmCollectCreatorFee(conn, coinFee, payer.publicKey), [payer], [], 200_000);
  out["creatorFeeCollectedSats"] = ((await bal(coinFee, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM)) - feeBefore).toString();
  void ata;
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

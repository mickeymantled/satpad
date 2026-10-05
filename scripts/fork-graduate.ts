// M6 task 1: graduate a BTC-quoted coin on the fork — buy the curve out with minted wBTC, then call pump's
// permissionless `migrate_v2` (VERIFIED V17) so a PumpSwap pool exists. Records the graduation cost (V5).
// Usage: LOCAL_RPC_URL=http://127.0.0.1:8999 FORK_KEYS_DIR=scripts/fork-keys-m6 npx tsx scripts/fork-graduate.ts [--mint <mint>] [--dry-run]
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, canonicalPumpPoolPdaWithQuote } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, PUMP_AMM_PROGRAM_ID, buildBuyV2, coinFeePda, defaultFeeRecipients, quoteSatsForTokens } from "@satpad/sdk";
import { Connection } from "@solana/web3.js";
import { KEYS_DIR, RPC, fundWbtc, send } from "./lib/fork";
import { DRY_RUN, arg } from "./lib/cli";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seed = JSON.parse(readFileSync(`${KEYS_DIR}/seed.json`, "utf8")) as { wallets: Record<string, { secret: number[] }>; coins: { mint: string; symbol: string }[] };
  const payer = Keypair.fromSecretKey(Uint8Array.from(seed.wallets["deployer"]!.secret));
  const mint = new PublicKey(arg("mint") ?? seed.coins[0]!.mint);
  const sdk = new OnlinePumpSdk(conn);
  const [global, feeConfig, quoteControl, curve] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig(), sdk.fetchQuoteControl(), sdk.fetchBondingCurve(mint)]);
  if (curve.complete) console.log("curve already complete; skipping buy-out");
  const tokens = BigInt(curve.realTokenReserves.toString());
  const inputs = { global, feeConfig, quoteControl, mintSupply: BigInt(curve.tokenTotalSupply.toString()), bondingCurve: curve };
  const cost = tokens > 0n ? quoteSatsForTokens(inputs, tokens) : 0n; // V5: sats to buy the remaining real reserves, fees included
  const maxQuoteIn = cost + cost / 50n + 1n; // 2% slack for rounding
  console.log(JSON.stringify({ rpc: RPC, mint: mint.toBase58(), realTokenReserves: tokens.toString(), realQuoteReserves: curve.realQuoteReserves?.toString(), graduationCostSats: cost.toString(), complete: curve.complete, creator: curve.creator.toBase58() }, null, 2));
  if (DRY_RUN) { console.log("(dry-run) nothing sent"); return; }

  let buySig: string | null = null;
  if (!curve.complete) {
    await fundWbtc(conn, payer, payer.publicKey, maxQuoteIn);
    const ixs = await buildBuyV2({ user: payer.publicKey, mint, creator: curve.creator, recipients: defaultFeeRecipients(global), tokenAmount: tokens, maxQuoteIn });
    buySig = await send(conn, ixs, [payer], [], 400_000);
    const after = await sdk.fetchBondingCurve(mint);
    if (!after.complete) throw new Error(`curve not complete after buy-out: real_token_reserves=${after.realTokenReserves.toString()}`);
    console.log(`buy-out confirmed ${buySig}; complete=true`);
  }
  // V17: migrate_v2 — `user` is the only signer; withdraw_authority is Global.withdraw_authority (a plain account).
  const ix = await PUMP_SDK.migrateV2Instruction({ withdrawAuthority: global.withdrawAuthority, mint, user: payer.publicKey, quoteMint: BTC_QUOTE_MINT, baseTokenProgram: COIN_TOKEN_PROGRAM, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM });
  const migrateSig = await send(conn, [ix], [payer], [], 600_000);
  const pool = canonicalPumpPoolPdaWithQuote(mint, BTC_QUOTE_MINT);
  const [lpMint] = PublicKey.findProgramAddressSync([Buffer.from("pool_lp_mint"), pool.toBuffer()], PUMP_AMM_PROGRAM_ID);
  const [poolInfo, lpInfo] = await Promise.all([conn.getAccountInfo(pool, "confirmed"), conn.getAccountInfo(lpMint, "confirmed")]);
  console.log(JSON.stringify({ buySig, migrateSig, pool: pool.toBase58(), poolOwner: poolInfo?.owner.toBase58() ?? null, poolBytes: poolInfo?.data.length ?? 0, lpMint: lpMint.toBase58(), lpMintExists: Boolean(lpInfo), coinFee: coinFeePda(mint)[0].toBase58() }, null, 2));
  if (!poolInfo || !poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error("pool account missing or not owned by PumpSwap");
}
main().catch((e) => { console.error(e); process.exit(1); });

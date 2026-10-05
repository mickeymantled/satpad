// LP deposit loop (SPEC "Protocol-owned liquidity: the Reserve", keeper row 3): one transaction — `draw_lp` (LP wallet
// signs, ≤ lp_draw_max, ≥ lp_draw_interval since the last draw) → PumpSwap `buy` of roughly half the budget into
// $SATPAD → `deposit` both sides → SPL burn of exactly the LP minted. Any failure reverts the whole thing and the BTC
// stays in LpPot. Over the Reserve lookup table (D14 pattern) because the four instructions exceed 1232 bytes.
// Guard: LP mint supply must not increase across the run (alert + failure otherwise).
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, LP_TOKEN_PROGRAM, ammQuoteTokensForSats, buildAmmBuy, buildAmmDeposit, buildDrawLp, lpMintOf, lpPotPda, type Config, type LiquiditySolanaState, type SwapSolanaState } from "@satpad/sdk";
import type { Alerter } from "../alerts";
import type { ChainReader } from "../chain";
import type { Logger } from "../log";
import type { TxSender } from "./settle";

export interface LpDeps {
  chain: ChainReader;
  sender: TxSender;
  lpWallet: Keypair;
  /** Skip draws smaller than this (fees). */
  minDrawSats: bigint;
  slippagePct: number;
  swapState: (pool: PublicKey, user: PublicKey) => Promise<SwapSolanaState>;
  liquidityState: (pool: PublicKey, user: PublicKey) => Promise<LiquiditySolanaState>;
  tables: AddressLookupTableAccount[];
  alerter: Alerter;
  log: Logger;
  now?: () => number;
  buildBuy?: typeof buildAmmBuy;
  buildDeposit?: typeof buildAmmDeposit;
}
export interface LpPlan { draw: bigint; buySats: bigint; tokensOut: bigint; maxQuoteIn: bigint; lpTokens: bigint; maxBase: bigint; maxQuote: bigint }
export interface LpResult { skipped?: string; plan?: LpPlan; signature?: string; lpSupplyBefore?: bigint; lpSupplyAfter?: bigint }

/**
 * Sizes one run from a draw plus whatever dust previous runs left in the LP wallet: swap half the sats budget, then mint
 * the most LP both sides can cover at the post-swap reserves (approximated from the quote; the deposit instruction takes
 * the exact pro-rata amounts up to maxBase/maxQuote, which are simply everything the wallet will hold).
 */
export function planLpRun(swap: SwapSolanaState, liq: LiquiditySolanaState, draw: bigint, walletSats: bigint, walletTokens: bigint, slippagePct: number): LpPlan | null {
  const budget = draw + walletSats;
  const buySats = budget / 2n;
  if (buySats <= 0n) return null;
  const q = ammQuoteTokensForSats(swap, buySats, slippagePct);
  if (q.tokens <= 0n) return null;
  const maxQuoteIn = q.maxQuoteIn > buySats ? q.maxQuoteIn : buySats;
  const satsLeft = budget - maxQuoteIn;
  const tokensAvail = walletTokens + q.tokens;
  if (satsLeft <= 0n) return null;
  const baseRes = liq.poolBaseTokenAccount.amount - q.tokens, quoteRes = liq.poolQuoteTokenAccount.amount + maxQuoteIn;
  const lpSupply = BigInt(liq.pool.lpSupply.toString());
  if (baseRes <= 0n || quoteRes <= 0n || lpSupply <= 0n) return null;
  const byQuote = (satsLeft * lpSupply) / quoteRes, byBase = (tokensAvail * lpSupply) / baseRes;
  const slip = BigInt(Math.ceil(slippagePct));
  const lpTokens = ((byQuote < byBase ? byQuote : byBase) * (100n - slip)) / 100n; // margin for the ceil in deposit and quote drift
  if (lpTokens <= 0n) return null;
  return { draw, buySats, tokensOut: q.tokens, maxQuoteIn, lpTokens, maxBase: tokensAvail, maxQuote: satsLeft };
}

export async function lpTick(deps: LpDeps, config: Config): Promise<LpResult> {
  if (config.paused) return { skipped: "vault paused" };
  if (config.satpadPool.equals(PublicKey.default) || config.satpadMint.equals(PublicKey.default)) return { skipped: "satpad pool not set (bootstrap first)" };
  const wallet = deps.lpWallet.publicKey;
  if (!config.lpWallet.equals(wallet)) throw new Error(`LP keypair ${wallet.toBase58()} is not Config.lp_wallet ${config.lpWallet.toBase58()}`);
  const nowS = BigInt(Math.floor((deps.now ?? Date.now)() / 1000));
  const since = nowS - config.lastLpDrawTs;
  if (config.lastLpDrawTs !== 0n && since < config.lpDrawIntervalSecs) return { skipped: `last draw ${since}s ago (< ${config.lpDrawIntervalSecs}s)` };
  const [pot, walletSats, walletTokens] = await deps.chain.tokenBalances([lpPotPda()[0], ata(BTC_QUOTE_MINT, wallet, BTC_QUOTE_TOKEN_PROGRAM), ata(config.satpadMint, wallet, COIN_TOKEN_PROGRAM)]);
  const potBal = pot ?? 0n;
  const draw = potBal < config.lpDrawMax ? potBal : config.lpDrawMax;
  if (draw < deps.minDrawSats) return { skipped: `LpPot ${potBal} below LP_MIN_DRAW_SATS ${deps.minDrawSats}` };
  const [swap, liq] = await Promise.all([deps.swapState(config.satpadPool, wallet), deps.liquidityState(config.satpadPool, wallet)]);
  if (!swap.pool.baseMint.equals(config.satpadMint)) throw new Error("pool base mint is not Config.satpad_mint");
  const plan = planLpRun(swap, liq, draw, walletSats ?? 0n, walletTokens ?? 0n, deps.slippagePct);
  if (!plan) return { skipped: "nothing depositable at this size" };
  const lpMint = lpMintOf(liq.pool);
  const lpAta = ata(lpMint, wallet, LP_TOKEN_PROGRAM);
  const ixs: TransactionInstruction[] = [
    await buildDrawLp({ lpWallet: wallet, amount: plan.draw }),
    ...(await (deps.buildBuy ?? buildAmmBuy)(swap, plan.tokensOut, plan.maxQuoteIn)),
    ...(await (deps.buildDeposit ?? buildAmmDeposit)(liq, plan.lpTokens, plan.maxBase, plan.maxQuote)),
    createBurnInstruction(lpAta, lpMint, wallet, plan.lpTokens, [], LP_TOKEN_PROGRAM),
  ];
  const lpSupplyBefore = await deps.chain.mintSupply(lpMint, LP_TOKEN_PROGRAM);
  const { signature } = await deps.sender.send(
    { type: "lp_deposit", actor: wallet.toBase58(), amounts: { drawn: plan.draw.toString(), satsSwapped: plan.maxQuoteIn.toString(), tokensBought: plan.tokensOut.toString(), lpMinted: plan.lpTokens.toString(), lpBurned: plan.lpTokens.toString(), poolBaseBefore: liq.poolBaseTokenAccount.amount.toString(), poolQuoteBefore: liq.poolQuoteTokenAccount.amount.toString() } },
    ixs, [deps.lpWallet], { tables: deps.tables },
  );
  const lpSupplyAfter = await deps.chain.mintSupply(lpMint, LP_TOKEN_PROGRAM);
  if (lpSupplyAfter > lpSupplyBefore) {
    await deps.alerter.alert("LP mint supply increased", `run ${signature}: ${lpSupplyBefore} → ${lpSupplyAfter}`);
    throw new Error(`LP mint supply increased ${lpSupplyBefore} → ${lpSupplyAfter} (run ${signature})`);
  }
  deps.log.info("lp run", { drawn: plan.draw.toString(), swapped: plan.maxQuoteIn.toString(), lpBurned: plan.lpTokens.toString(), signature });
  return { plan, signature, lpSupplyBefore, lpSupplyAfter };
}

const ata = (mint: PublicKey, owner: PublicKey, program: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, program);

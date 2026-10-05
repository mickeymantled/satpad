// Buyback-and-burn loop (SPEC "Keeper service", second row): every BUYBACK_INTERVAL_MS, swap the buyback wallet's whole
// wBTC balance for $SATPAD on the Reserve pool (Config.satpad_pool) and burn what was bought — one transaction, so a
// failed burn reverts the buy. Skips below BUYBACK_MIN_SATS to save fees and while the pool is not bootstrapped.
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createBurnInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, ammQuoteTokensForSats, buildAmmBuy, type Config, type SwapSolanaState } from "@satpad/sdk";
import type { Alerter } from "../alerts";
import type { ChainReader } from "../chain";
import type { Logger } from "../log";
import type { TxSender } from "./settle";

export interface BuybackDeps {
  chain: ChainReader;
  sender: TxSender;
  /** Hot key that owns the buyback wallet's wBTC (DECISIONS D22). */
  buybackWallet: Keypair;
  minSats: bigint;
  slippagePct: number;
  /** `ammSwapState(conn, pool, user)` in production; scripted in tests. */
  swapState: (pool: PublicKey, user: PublicKey) => Promise<SwapSolanaState>;
  buildBuy?: (state: SwapSolanaState, tokensOut: bigint, maxQuoteIn: bigint) => Promise<TransactionInstruction[]>;
  quote?: (state: SwapSolanaState, sats: bigint, slippagePct: number) => { tokens: bigint; maxQuoteIn: bigint };
  log: Logger;
  /** D22 mitigation: settled buyback share of the last hour (from the ledger); the wallet must never hold more than that. */
  inflowLastHour?: () => Promise<bigint>;
  alerter?: Alerter;
}
export interface BuybackResult { skipped?: string; sats?: bigint; tokens?: bigint; signature?: string }

export async function buybackTick(deps: BuybackDeps, config: Config): Promise<BuybackResult> {
  if (config.paused) return { skipped: "vault paused" };
  if (config.satpadPool.equals(PublicKey.default) || config.satpadMint.equals(PublicKey.default)) return { skipped: "satpad pool not set (bootstrap first)" };
  const wallet = deps.buybackWallet.publicKey;
  const wbtcAta = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, wallet, true, BTC_QUOTE_TOKEN_PROGRAM);
  const balance = (await deps.chain.tokenBalance(wbtcAta)) ?? 0n;
  // D22: the hot wallet should hold at most about one interval of inflow; more than an hour's worth means the loop is not
  // keeping up (or the key is being used elsewhere) — alert, then still try to spend it down.
  if (deps.inflowLastHour && deps.alerter) {
    const inflow = await deps.inflowLastHour();
    if (balance > inflow && balance > deps.minSats) await deps.alerter.alert("buyback wallet balance above one hour of inflow", `balance ${balance} sats, settled buyback share last hour ${inflow} sats`);
  }
  if (balance < deps.minSats) return { skipped: `balance ${balance} below BUYBACK_MIN_SATS ${deps.minSats}` };
  const state = await deps.swapState(config.satpadPool, wallet);
  if (!state.pool.baseMint.equals(config.satpadMint)) throw new Error(`pool ${config.satpadPool.toBase58()} base mint is not Config.satpad_mint`);
  // Quote slightly under the balance so the slippage-capped max never exceeds what the wallet holds.
  const spend = (balance * 100n) / (100n + BigInt(Math.ceil(deps.slippagePct)));
  const q = (deps.quote ?? ammQuoteTokensForSats)(state, spend, deps.slippagePct);
  if (q.tokens <= 0n) return { skipped: "quote returned no tokens" };
  const maxQuoteIn = q.maxQuoteIn > balance ? balance : q.maxQuoteIn;
  const satpadAta = getAssociatedTokenAddressSync(config.satpadMint, wallet, true, COIN_TOKEN_PROGRAM);
  const ixs = [
    ...(await (deps.buildBuy ?? buildAmmBuy)(state, q.tokens, maxQuoteIn)),
    createBurnInstruction(satpadAta, config.satpadMint, wallet, q.tokens, [], TOKEN_2022_PROGRAM_ID), // $SATPAD is a Token-2022 mint like every pump coin
  ];
  const { signature } = await deps.sender.send(
    { type: "buyback", actor: wallet.toBase58(), amounts: { sats: maxQuoteIn.toString(), tokens: q.tokens.toString(), burned: q.tokens.toString() } },
    ixs, [deps.buybackWallet],
  );
  deps.log.info("buyback and burn", { sats: maxQuoteIn.toString(), tokens: q.tokens.toString(), signature });
  return { sats: maxQuoteIn, tokens: q.tokens, signature };
}

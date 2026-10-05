// PumpSwap (post-graduation) wrappers over @pump-fun/pump-swap-sdk 1.20.0 (VERIFIED V18, pinned IDL in idl-ref/).
// Every amount is bigint in base units; the swap SDK's BN inputs/outputs are converted at the boundary. The pool for a
// Satpad coin is the canonical pump pool quoted in BTC_QUOTE_MINT; its `coin_creator` is the coin's CoinFee PDA, so
// AMM creator fees keep flowing to the vault (SPEC "Graduation").
import BN from "bn.js";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { canonicalPumpPoolPdaWithQuote } from "@pump-fun/pump-sdk";
import {
  OnlinePumpAmmSdk, PUMP_AMM_SDK, buyBaseInput, buyQuoteInput, depositLpToken, lpMintPda, sellBaseInput,
  type LiquiditySolanaState, type Pool, type SwapSolanaState,
} from "@pump-fun/pump-swap-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM } from "./quoteMints";

const bn = (v: bigint) => new BN(v.toString());
const big = (v: BN) => BigInt(v.toString());

/** The PumpSwap pool pump migrates a BTC-quoted coin into. */
export const poolForMint = (mint: PublicKey): PublicKey => canonicalPumpPoolPdaWithQuote(mint, BTC_QUOTE_MINT);
/** LP mint of a pool: PDA ["pool_lp_mint", pool] of the AMM program (= `Pool.lpMint`). It is a **Token-2022** mint (V18). */
export const lpMintForPool = (pool: PublicKey): PublicKey => lpMintPda(pool);
export const lpMintOf = (pool: Pool): PublicKey => pool.lpMint;
export const LP_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

export const ammOnline = (conn: Connection) => new OnlinePumpAmmSdk(conn);
export const decodePool = (data: Buffer): Pool => PUMP_AMM_SDK.decodePool({ data, executable: false, lamports: 0, owner: PublicKey.default });

/** Everything a swap needs, fetched from chain (pool, reserves, global + fee config, the user's ATAs). */
export async function ammSwapState(conn: Connection, pool: PublicKey, user: PublicKey): Promise<SwapSolanaState> {
  return ammOnline(conn).swapSolanaState(pool, user);
}
export async function ammLiquidityState(conn: Connection, pool: PublicKey, user: PublicKey): Promise<LiquiditySolanaState> {
  return ammOnline(conn).liquiditySolanaState(pool, user);
}

type MathState = Pick<SwapSolanaState, "pool" | "poolBaseAmount" | "poolQuoteAmount" | "globalConfig" | "feeConfig" | "baseMint" | "baseMintAccount">;
const mathArgs = (s: MathState) => ({
  baseReserve: s.poolBaseAmount, quoteReserve: s.poolQuoteAmount, virtualQuoteReserves: s.pool.virtualQuoteReserves, globalConfig: s.globalConfig, feeConfig: s.feeConfig,
  baseMintAccount: s.baseMintAccount, baseMint: s.baseMint, coinCreator: s.pool.coinCreator, creator: s.pool.creator, quoteMint: s.pool.quoteMint, isMayhemMode: s.pool.isMayhemMode, creatorFeeBps: s.pool.creatorFeeBps,
});

/** Tokens out for `sats` in (after LP, protocol and creator fees), and the max sats to allow at `slippagePct`. */
export function ammQuoteTokensForSats(s: MathState, sats: bigint, slippagePct = 1): { tokens: bigint; maxQuoteIn: bigint } {
  const r = buyQuoteInput({ ...mathArgs(s), quote: bn(sats), slippage: slippagePct });
  return { tokens: big(r.base), maxQuoteIn: big(r.maxQuote) };
}
/** Sats needed for `tokens` out, fees included, and the slippage-capped maximum. */
export function ammQuoteSatsForTokens(s: MathState, tokens: bigint, slippagePct = 1): { sats: bigint; maxQuoteIn: bigint } {
  const r = buyBaseInput({ ...mathArgs(s), base: bn(tokens), slippage: slippagePct });
  return { sats: big(r.uiQuote), maxQuoteIn: big(r.maxQuote) };
}
/** Sats received for selling `tokens` after fees, and the slippage-capped minimum. */
export function ammQuoteSatsForSell(s: MathState, tokens: bigint, slippagePct = 1): { sats: bigint; minQuoteOut: bigint } {
  const r = sellBaseInput({ ...mathArgs(s), base: bn(tokens), slippage: slippagePct });
  return { sats: big(r.uiQuote), minQuoteOut: big(r.minQuote) };
}

/** PumpSwap `buy`: exactly `tokensOut` base tokens for at most `maxQuoteIn` sats. Creates the user's ATAs idempotently. */
export function buildAmmBuy(state: SwapSolanaState, tokensOut: bigint, maxQuoteIn: bigint): Promise<TransactionInstruction[]> {
  return PUMP_AMM_SDK.buyInstructions(state, bn(tokensOut), bn(maxQuoteIn));
}
/** PumpSwap `sell`: `tokensIn` base tokens for at least `minQuoteOut` sats. */
export function buildAmmSell(state: SwapSolanaState, tokensIn: bigint, minQuoteOut: bigint): Promise<TransactionInstruction[]> {
  return PUMP_AMM_SDK.sellInstructions(state, bn(tokensIn), bn(minQuoteOut));
}

/**
 * Two-sided deposit sized by the quote side (the Reserve's BTC leg, SPEC "Protocol-owned liquidity"): the pool mints
 * exactly `lpTokens`, which the caller burns in the same transaction. Returns the amounts so the burn can be exact.
 */
export function ammDepositForSats(state: LiquiditySolanaState, sats: bigint, slippagePct = 1): { lpTokens: bigint; base: bigint; maxBase: bigint; maxQuote: bigint } {
  const r = PUMP_AMM_SDK.depositQuoteInput(state, bn(sats), slippagePct);
  return { lpTokens: big(r.lpToken), base: big(r.base), maxBase: big(r.maxBase), maxQuote: big(r.maxQuote) };
}
/** Base/quote needed to mint exactly `lpTokens` (pro rata, ceil), slippage-capped. */
export function ammDepositForLp(pool: Pool, baseReserve: bigint, quoteReserve: bigint, lpTokens: bigint, slippagePct = 1): { maxBase: bigint; maxQuote: bigint } {
  const r = depositLpToken(bn(lpTokens), slippagePct, bn(baseReserve), bn(quoteReserve), pool.lpSupply);
  return { maxBase: big(r.maxBase), maxQuote: big(r.maxQuote) };
}
export function buildAmmDeposit(state: LiquiditySolanaState, lpTokens: bigint, maxBase: bigint, maxQuote: bigint): Promise<TransactionInstruction[]> {
  return PUMP_AMM_SDK.depositInstructionsInternal(state, bn(lpTokens), bn(maxBase), bn(maxQuote));
}

/** PumpSwap `collect_coin_creator_fee` for a CoinFee PDA: moves the AMM creator vault's wBTC into the CoinFee's wBTC ATA. */
export async function buildAmmCollectCreatorFee(conn: Connection, coinCreator: PublicKey, payer?: PublicKey): Promise<TransactionInstruction[]> {
  const state = await ammOnline(conn).collectCoinCreatorFeeSolanaState(coinCreator, undefined, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM);
  return PUMP_AMM_SDK.collectCoinCreatorFee(state, payer);
}

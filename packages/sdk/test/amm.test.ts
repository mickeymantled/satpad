import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import type { LiquiditySolanaState, SwapSolanaState } from "@pump-fun/pump-swap-sdk";
import { BTC_QUOTE_MINT, LP_TOKEN_PROGRAM, PUMP_AMM_PROGRAM_ID, ammDepositForLp, ammDepositForSats, ammQuoteSatsForSell, ammQuoteSatsForTokens, ammQuoteTokensForSats, buildAmmBuy, buildAmmDeposit, buildAmmSell, coinFeePda, lpMintForPool, lpMintOf, poolForMint } from "../src";

/** Reverses scripts/capture-amm-state.ts: {$bn}/{$pk}/{$big}/{$b64} markers back to BN / PublicKey / bigint / Buffer. */
function revive(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(revive);
  const o = v as Record<string, unknown>;
  if ("$bn" in o) return new BN(o["$bn"] as string);
  if ("$pk" in o) return new PublicKey(o["$pk"] as string);
  if ("$big" in o) return BigInt(o["$big"] as string);
  if ("$b64" in o) return Buffer.from(o["$b64"] as string, "base64");
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "amm_state.json"), "utf8")) as { mint: string; user: string; pool: string; swap: unknown; liquidity: unknown };
const swap = revive(fx.swap) as SwapSolanaState, liq = revive(fx.liquidity) as LiquiditySolanaState;
const mint = new PublicKey(fx.mint), pool = new PublicKey(fx.pool), user = new PublicKey(fx.user);
const idl = JSON.parse(readFileSync(path.join(__dirname, "../../../idl-ref/pump_amm_sdk1.20.0.json"), "utf8")) as { instructions: { name: string; discriminator: number[] }[] };
const ixName = (data: Buffer) => idl.instructions.find((i) => Buffer.from(i.discriminator).equals(data.subarray(0, 8)))?.name;

describe("PumpSwap wrappers (V18, state captured from the fork after migrate_v2)", () => {
  it("derives the canonical BTC-quoted pool and its Token-2022 LP mint; the pool's coin_creator is the CoinFee PDA", () => {
    expect(poolForMint(mint).equals(pool)).toBe(true);
    expect(swap.pool.quoteMint.equals(BTC_QUOTE_MINT)).toBe(true);
    expect(lpMintForPool(pool).equals(lpMintOf(swap.pool))).toBe(true);
    expect(LP_TOKEN_PROGRAM.toBase58()).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(swap.pool.coinCreator.equals(coinFeePda(mint)[0])).toBe(true);
    expect(Number(swap.pool.creatorFeeBps)).toBe(100); // carried over from the curve (D3)
  });
  it("buy quote round-trips within fee rounding and respects the slippage cap", () => {
    const sats = 10_000n; // small next to the 9.3M-sat pool so price impact stays below fee size
    const q = ammQuoteTokensForSats(swap, sats, 1);
    expect(q.tokens).toBeGreaterThan(0n);
    expect(q.maxQuoteIn).toBe(10_100n);
    const back = ammQuoteSatsForTokens(swap, q.tokens, 1);
    expect(back.sats).toBeGreaterThanOrEqual(sats - 10n);
    expect(back.sats).toBeLessThanOrEqual(sats + 10n);
    expect(back.maxQuoteIn).toBeGreaterThanOrEqual(back.sats);
    const sell = ammQuoteSatsForSell(swap, q.tokens, 1);
    expect(sell.sats).toBeLessThan(sats); // fees both ways: lp 20 + protocol 5 + creator 100 bps ≈ 1.25% per side
    expect(sell.sats).toBeGreaterThan((sats * 96n) / 100n);
    const big = ammQuoteTokensForSats(swap, 1_000_000n, 1); // a 1M-sat buy moves this small pool ≈ 10%
    expect(ammQuoteSatsForSell(swap, big.tokens, 1).sats).toBeLessThan((1_000_000n * 90n) / 100n);
    expect(sell.minQuoteOut).toBeLessThan(sell.sats);
  });
  it("deposit sized by sats is pro rata and the LP-sized variant ceils", () => {
    const d = ammDepositForSats(liq, 50_000n, 1);
    const baseRes = liq.poolBaseTokenAccount.amount, quoteRes = liq.poolQuoteTokenAccount.amount;
    expect(d.lpTokens).toBeGreaterThan(0n);
    expect(d.base).toBe((50_000n * baseRes) / quoteRes);
    expect(d.maxQuote).toBe(50_500n);
    // LP-sized deposit uses the pool's lpSupply counter (ceil); both formulas agree to within 1e-8 relative
    const l = ammDepositForLp(liq.pool, baseRes, quoteRes, d.lpTokens, 0);
    const close = (a: bigint, b: bigint) => (a > b ? a - b : b - a) * 100_000_000n <= (a > b ? a : b);
    expect(close(l.maxQuote, 50_000n)).toBe(true);
    expect(close(l.maxBase, d.base)).toBe(true);
  });
  it("builders target the AMM program with the pool and the user as signer; names decode via the pinned IDL", async () => {
    const buy = await buildAmmBuy(swap, 1_000n, 10n);
    const sell = await buildAmmSell(swap, 1_000n, 1n);
    const dep = await buildAmmDeposit(liq, 1_000n, 10n, 10n);
    for (const [ixs, name] of [[buy, "buy"], [sell, "sell"], [dep, "deposit"]] as const) {
      const main = ixs.filter((ix) => ix.programId.equals(PUMP_AMM_PROGRAM_ID));
      expect(main.length).toBeGreaterThanOrEqual(1);
      const target = main.find((ix) => ixName(Buffer.from(ix.data)) === name)!;
      expect(target, name).toBeDefined();
      expect(target.keys.some((k) => k.pubkey.equals(pool))).toBe(true);
      expect(target.keys.some((k) => k.pubkey.equals(user) && k.isSigner)).toBe(true);
    }
    expect(dep.some((ix) => ix.keys.some((k) => k.pubkey.equals(lpMintOf(liq.pool))))).toBe(true);
  });
});

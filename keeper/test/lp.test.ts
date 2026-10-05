import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, DEFAULT_SPLIT, LP_TOKEN_PROGRAM, lpMintOf, lpPotPda, type Config, type LiquiditySolanaState, type SwapSolanaState } from "@satpad/sdk";
import type { ChainReader } from "../src/chain";
import type { LedgerEntry } from "../src/ledger";
import { createLogger } from "../src/log";
import { lpTick, planLpRun, type LpDeps } from "../src/loops/lp";
import type { TxSender } from "../src/loops/settle";

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
const fx = JSON.parse(readFileSync(path.join(__dirname, "../../packages/sdk/test/fixtures/amm_state.json"), "utf8")) as { mint: string; pool: string; swap: unknown; liquidity: unknown };
const swap = revive(fx.swap) as SwapSolanaState, liq = revive(fx.liquidity) as LiquiditySolanaState;
const lpWallet = Keypair.generate();
const k = () => Keypair.generate().publicKey;
const cfg = (over: Partial<Config> = {}): Config => ({ admin: k(), treasury: k(), buybackWallet: k(), rewardsWallet: k(), lpWallet: lpWallet.publicKey, quoteMint: BTC_QUOTE_MINT, quoteDecimals: 8, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, paused: false, launchFeeLamports: 0n, satpadMint: new PublicKey(fx.mint), satpadPool: new PublicKey(fx.pool), satpadLpMint: lpMintOf(liq.pool), lastLpDrawTs: 0n, ...over });
const ata = (m: PublicKey, o: PublicKey, p: PublicKey) => getAssociatedTokenAddressSync(m, o, true, p);
const ix = () => new TransactionInstruction({ programId: k(), keys: [], data: Buffer.alloc(0) });

describe("planLpRun (sizing on the captured pool state)", () => {
  it("swaps half the budget and mints LP both sides can cover, below the pro-rata maximum", () => {
    const p = planLpRun(swap, liq, 100_000n, 0n, 0n, 1)!;
    expect(p).not.toBeNull();
    expect(p.draw).toBe(100_000n);
    expect(p.buySats).toBe(50_000n);
    expect(p.maxQuoteIn).toBe(50_500n);
    expect(p.maxQuote).toBe(49_500n);
    expect(p.tokensOut).toBeGreaterThan(0n);
    expect(p.maxBase).toBe(p.tokensOut);
    const lpSupply = BigInt(liq.pool.lpSupply.toString());
    const quoteRes = liq.poolQuoteTokenAccount.amount + p.maxQuoteIn, baseRes = liq.poolBaseTokenAccount.amount - p.tokensOut;
    expect(p.lpTokens).toBeLessThanOrEqual((p.maxQuote * lpSupply) / quoteRes);
    expect(p.lpTokens).toBeLessThanOrEqual((p.maxBase * lpSupply) / baseRes);
    expect(p.lpTokens).toBeGreaterThan(0n);
  });
  it("recycles wallet dust into the budget and returns null when nothing is depositable", () => {
    const a = planLpRun(swap, liq, 100_000n, 0n, 0n, 1)!, b = planLpRun(swap, liq, 100_000n, 20_000n, 0n, 1)!;
    expect(b.buySats).toBe(60_000n);
    expect(b.lpTokens).toBeGreaterThan(a.lpTokens);
    expect(planLpRun(swap, liq, 0n, 0n, 0n, 1)).toBeNull();
    expect(planLpRun(swap, liq, 1n, 0n, 0n, 1)).toBeNull();
  });
});

function world(balances: Record<string, bigint | null>, supply: bigint[] = [0n, 0n]) {
  const sent: { entry: LedgerEntry; ixs: TransactionInstruction[]; signers: Keypair[]; opts?: { tables?: AddressLookupTableAccount[] } }[] = [];
  let calls = 0;
  const chain: ChainReader = {
    tokenBalance: async (a) => balances[a.toBase58()] ?? null, tokenBalances: async (as) => as.map((a) => balances[a.toBase58()] ?? null),
    vaultConfig: async () => cfg(), slot: async () => 1n, mintSupply: async () => supply[Math.min(calls++, supply.length - 1)]!,
  };
  const alerts: string[] = [];
  const sender: TxSender = { send: async (entry, ixs, signers, opts) => { sent.push({ entry, ixs, signers, ...(opts && { opts }) }); return { signature: "sigLP" }; } };
  const table = new AddressLookupTableAccount({ key: k(), state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [] } });
  const deps: LpDeps = { chain, sender, lpWallet, minDrawSats: 10_000n, slippagePct: 1, swapState: async () => swap, liquidityState: async () => liq, tables: [table], alerter: { alert: async (t) => { alerts.push(t); } }, log: createLogger({}, "error", () => {}), now: () => 1_000_000_000 * 1000 /* ms, like Date.now() */, buildBuy: async () => [ix()], buildDeposit: async () => [ix(), ix()] };
  return { deps, sent, alerts, table };
}
const pot = (sats: bigint | null) => ({ [lpPotPda()[0].toBase58()]: sats, [ata(BTC_QUOTE_MINT, lpWallet.publicKey, BTC_QUOTE_TOKEN_PROGRAM).toBase58()]: 0n, [ata(new PublicKey(fx.mint), lpWallet.publicKey, COIN_TOKEN_PROGRAM).toBase58()]: 0n });

describe("lpTick", () => {
  it("skips when paused, before bootstrap, inside the interval, and below the minimum draw", async () => {
    expect((await lpTick(world(pot(100_000n)).deps, cfg({ paused: true }))).skipped).toMatch(/paused/);
    expect((await lpTick(world(pot(100_000n)).deps, cfg({ satpadPool: PublicKey.default }))).skipped).toMatch(/not set/);
    expect((await lpTick(world(pot(100_000n)).deps, cfg({ lastLpDrawTs: 1_000_000_000n - 100n }))).skipped).toMatch(/last draw 100s ago/);
    expect((await lpTick(world(pot(5_000n)).deps, cfg())).skipped).toMatch(/below LP_MIN_DRAW_SATS/);
    expect((await lpTick(world(pot(null)).deps, cfg())).skipped).toMatch(/below/);
  });
  it("draws min(pot, lp_draw_max), sends draw_lp + buy + deposit + burn over the table, signed by the LP wallet, with the ledger amounts", async () => {
    const w = world(pot(800_000n));
    const r = await lpTick(w.deps, cfg({ lastLpDrawTs: 1_000_000_000n - 300n }));
    expect(w.sent).toHaveLength(1);
    const { entry, ixs, signers, opts } = w.sent[0]!;
    expect(entry.type).toBe("lp_deposit");
    expect(entry.amounts["drawn"]).toBe("500000"); // capped by lp_draw_max
    expect(entry.amounts["lpMinted"]).toBe(entry.amounts["lpBurned"]);
    expect(ixs).toHaveLength(1 + 1 + 2 + 1);
    expect(ixs[4]!.programId.equals(LP_TOKEN_PROGRAM)).toBe(true);
    expect(signers).toEqual([lpWallet]);
    expect(opts?.tables).toEqual([w.table]);
    expect(r.signature).toBe("sigLP");
    expect(r.plan!.draw).toBe(500_000n);
  });
  it("alerts and fails when the LP mint supply grew across the run; refuses a wrong LP key", async () => {
    const w = world(pot(100_000n), [10n, 11n]);
    await expect(lpTick(w.deps, cfg())).rejects.toThrow(/LP mint supply increased 10 → 11/);
    expect(w.alerts).toEqual(["LP mint supply increased"]);
    await expect(lpTick(world(pot(100_000n)).deps, cfg({ lpWallet: k() }))).rejects.toThrow(/not Config.lp_wallet/);
  });
});

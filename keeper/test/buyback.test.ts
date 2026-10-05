import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, DEFAULT_SPLIT, type Config, type SwapSolanaState } from "@satpad/sdk";
import type { ChainReader } from "../src/chain";
import type { LedgerEntry } from "../src/ledger";
import { createLogger } from "../src/log";
import { buybackTick, type BuybackDeps } from "../src/loops/buyback";
import type { TxSender } from "../src/loops/settle";

const k = () => Keypair.generate().publicKey;
const wallet = Keypair.generate();
const satpadMint = k(), satpadPool = k();
const base = (over: Partial<Config> = {}): Config => ({ admin: k(), treasury: k(), buybackWallet: wallet.publicKey, rewardsWallet: k(), lpWallet: k(), quoteMint: BTC_QUOTE_MINT, quoteDecimals: 8, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, paused: false, launchFeeLamports: 0n, satpadMint, satpadPool, satpadLpMint: k(), lastLpDrawTs: 0n, ...over });
const wbtcAta = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, wallet.publicKey, true, BTC_QUOTE_TOKEN_PROGRAM);
const buyIx = new TransactionInstruction({ programId: k(), keys: [], data: Buffer.from([1]) });

function deps(balance: bigint | null, over: Partial<BuybackDeps> = {}) {
  const sent: { entry: LedgerEntry; ixs: TransactionInstruction[]; signers: Keypair[] }[] = [];
  const chain: ChainReader = { tokenBalance: async (a) => (a.equals(wbtcAta) ? balance : null), tokenBalances: async (as) => as.map((a) => (a.equals(wbtcAta) ? balance : null)), vaultConfig: async () => base(), slot: async () => 1n, mintSupply: async () => 0n };
  const sender: TxSender = { send: async (entry, ixs, signers) => { sent.push({ entry, ixs, signers }); return { signature: "sigB" }; } };
  const state = { pool: { baseMint: satpadMint } } as unknown as SwapSolanaState;
  const d: BuybackDeps = {
    chain, sender, buybackWallet: wallet, minSats: 10_000n, slippagePct: 1, swapState: async () => state,
    buildBuy: async () => [buyIx], quote: (_s, sats) => ({ tokens: sats * 1000n, maxQuoteIn: sats + sats / 100n }), log: createLogger({}, "error", () => {}), ...over,
  };
  return { d, sent };
}

describe("buybackTick (SPEC Buyback and burn)", () => {
  it("skips when paused, when the pool is not bootstrapped, and below the minimum", async () => {
    expect((await buybackTick(deps(100_000n).d, base({ paused: true }))).skipped).toMatch(/paused/);
    expect((await buybackTick(deps(100_000n).d, base({ satpadPool: PublicKey.default }))).skipped).toMatch(/not set/);
    expect((await buybackTick(deps(9_999n).d, base())).skipped).toMatch(/below/);
    expect((await buybackTick(deps(null).d, base())).skipped).toMatch(/below/);
  });
  it("buys with (almost) the whole balance and burns exactly the tokens bought, in one transaction signed by the buyback wallet", async () => {
    const { d, sent } = deps(100_000n);
    const r = await buybackTick(d, base());
    expect(sent).toHaveLength(1);
    const { entry, ixs, signers } = sent[0]!;
    expect(entry.type).toBe("buyback");
    expect(entry.actor).toBe(wallet.publicKey.toBase58());
    // spend = 100000 * 100 / 101 = 99009 → max 99009 + 990 = 99999 ≤ balance
    expect(entry.amounts).toEqual({ sats: "99999", tokens: "99009000", burned: "99009000" });
    expect(ixs[0]).toBe(buyIx);
    expect(ixs[1]!.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true); // burn of the Token-2022 $SATPAD
    expect(ixs[1]!.keys.some((x) => x.pubkey.equals(satpadMint))).toBe(true);
    expect(signers).toEqual([wallet]);
    expect(r).toMatchObject({ sats: 99_999n, tokens: 99_009_000n, signature: "sigB" });
  });
  it("refuses a pool whose base mint is not Config.satpad_mint, and lets send errors propagate (scheduler counts them)", async () => {
    const wrong = deps(100_000n, { swapState: async () => ({ pool: { baseMint: k() } } as unknown as SwapSolanaState) });
    await expect(buybackTick(wrong.d, base())).rejects.toThrow(/not Config.satpad_mint/);
    const failing = deps(100_000n, { sender: { send: async () => { throw new Error("rpc down"); } } });
    await expect(buybackTick(failing.d, base())).rejects.toThrow(/rpc down/);
  });
});

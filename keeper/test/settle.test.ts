import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ammCreatorVaultPda } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, DEFAULT_SPLIT, coinAccounts, coinFeePda, coinPda, payeePotPda, type Config } from "@satpad/sdk";
import type { ChainReader } from "../src/chain";
import type { RegisteredCoin } from "../src/coins";
import type { LedgerEntry } from "../src/ledger";
import { createLogger } from "../src/log";
import { settleTick, type TxSender } from "../src/loops/settle";

const keeper = Keypair.generate();
const k = () => Keypair.generate().publicKey;
const config: Config = { admin: k(), treasury: k(), buybackWallet: k(), rewardsWallet: k(), lpWallet: k(), quoteMint: BTC_QUOTE_MINT, quoteDecimals: 8, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, paused: false, launchFeeLamports: 0n, satpadMint: PublicKey.default, satpadPool: PublicKey.default, satpadLpMint: PublicKey.default, lastLpDrawTs: 0n };
const ata = (o: PublicKey) => getAssociatedTokenAddressSync(BTC_QUOTE_MINT, o, true, BTC_QUOTE_TOKEN_PROGRAM);

function coin(over: Partial<RegisteredCoin> = {}): RegisteredCoin {
  const mint = k();
  return { address: coinPda(mint)[0], mint, deployer: k(), payee: k(), payeeMode: "wallet", paused: false, createdAt: 0n, declared: true, treasuryOnly: false, lastRewardsRunTs: 0n, rewardsRunCount: 0n, ...over };
}

/** Scripted balances keyed by ATA; `send` mutates them the way the chain would. */
function world(balances: Map<string, bigint | null>, failOn: string[] = []) {
  const sent: { entry: LedgerEntry; ixs: TransactionInstruction[] }[] = [];
  const get = (a: PublicKey) => balances.has(a.toBase58()) ? balances.get(a.toBase58())! : null;
  const chain: ChainReader = {
    tokenBalance: async (a) => get(a), tokenBalances: async (as) => as.map(get), vaultConfig: async () => config, slot: async () => 1n, mintSupply: async () => 0n,
  };
  const sender: TxSender = {
    send: async (entry, ixs) => {
      if (failOn.includes(entry.mint ?? "")) throw new Error(`rpc down for ${entry.mint}`);
      sent.push({ entry, ixs });
      const mint = new PublicKey(entry.mint!);
      const [cf] = coinFeePda(mint);
      const a = coinAccounts(mint, cf);
      if (entry.type === "collect_creator_fee") { balances.set(a.creatorQuoteAta.toBase58(), (get(a.creatorQuoteAta) ?? 0n) + get(a.creatorVaultQuoteAta)!); balances.set(a.creatorVaultQuoteAta.toBase58(), 0n); }
      if (entry.type === "settle") { balances.set(a.creatorQuoteAta.toBase58(), 0n); balances.set(payeePotPda(mint)[0].toBase58(), (get(payeePotPda(mint)[0]) ?? 0n) + BigInt(entry.amounts["deployer"]!)); }
      if (entry.type === "pay_payee") balances.set(payeePotPda(mint)[0].toBase58(), 0n);
      return { signature: `sig${sent.length}` };
    },
  };
  return { chain, sender, sent };
}
const deps = (w: ReturnType<typeof world>) => ({ chain: w.chain, sender: w.sender, keeper, dustThreshold: 1_000n, log: createLogger({}, "error", () => {}) });
const seed = (c: RegisteredCoin, unclaimed: bigint, waiting: bigint | null = 0n, payeeHasAta = true) => {
  const a = coinAccounts(c.mint, coinFeePda(c.mint)[0]);
  const m = new Map<string, bigint | null>([[a.creatorVaultQuoteAta.toBase58(), unclaimed], [a.creatorQuoteAta.toBase58(), waiting], [payeePotPda(c.mint)[0].toBase58(), 0n]]);
  if (payeeHasAta) m.set(ata(c.payee).toBase58(), 0n);
  return m;
};

describe("settleTick", () => {
  it("graduated coin: collects the PumpSwap creator vault too (venue pool) and settles the sum", async () => {
    const c = coin();
    const m = seed(c, 10_000n);
    const [cf] = coinFeePda(c.mint);
    m.set(ata(ammCreatorVaultPda(cf)).toBase58(), 5_000n);
    const w = world(m);
    // the fake sender only models the curve vault; model the AMM vault move here
    const origSend = w.sender.send.bind(w.sender);
    w.sender.send = async (entry, ixs, signers) => { const r = await origSend(entry, ixs, signers); if (entry.amounts["venue"] === "pool") { const a = coinAccounts(c.mint, cf); m.set(a.creatorQuoteAta.toBase58(), (m.get(a.creatorQuoteAta.toBase58()) ?? 0n) + 5_000n); m.set(ata(ammCreatorVaultPda(cf)).toBase58(), 0n); } return r; };
    const collectIx = new TransactionInstruction({ programId: k(), keys: [], data: Buffer.alloc(0) });
    const s = await settleTick({ ...deps(w), ammCollect: async () => [collectIx] }, config, [c]);
    expect(w.sent.map((x) => `${x.entry.type}:${x.entry.amounts["venue"] ?? ""}`)).toEqual(["collect_creator_fee:curve", "collect_creator_fee:pool", "settle:", "pay_payee:"]);
    expect(w.sent[1]!.ixs).toEqual([collectIx]);
    expect(w.sent[2]!.entry.amounts["fee"]).toBe("15000");
    expect(s.outcomes[0]!.collected).toBe(15_000n);
  });
  it("graduated coin without an AMM collect builder: warns and settles only the curve part", async () => {
    const c = coin();
    const m = seed(c, 10_000n);
    m.set(ata(ammCreatorVaultPda(coinFeePda(c.mint)[0])).toBase58(), 5_000n);
    const w = world(m);
    const s = await settleTick(deps(w), config, [c]);
    expect(w.sent.map((x) => x.entry.type)).toEqual(["collect_creator_fee", "settle", "pay_payee"]);
    expect(s.outcomes[0]!.collected).toBe(10_000n);
  });
  it("collects, settles with the split in the ledger, and pays a payee who has an ATA", async () => {
    const c = coin();
    const w = world(seed(c, 10_000n));
    const s = await settleTick(deps(w), config, [c]);
    expect(w.sent.map((x) => x.entry.type)).toEqual(["collect_creator_fee", "settle", "pay_payee"]);
    expect(w.sent[1]!.entry.amounts).toEqual({ fee: "10000", liquidity: "2500", buyback: "2500", operator: "1000", deployer: "4000" });
    expect(w.sent[2]!.entry.amounts).toEqual({ amount: "4000" });
    expect(s).toMatchObject({ coins: 1, collected: 1, settled: 1, paid: 1, failed: 0 });
  });

  it("does nothing below the dust threshold; settles fees already waiting without a collect", async () => {
    const dust = coin(), waiting = coin();
    const m = new Map([...seed(dust, 999n), ...seed(waiting, 0n, 5_000n)]);
    const w = world(m);
    const s = await settleTick(deps(w), config, [dust, waiting]);
    expect(w.sent.map((x) => [x.entry.mint, x.entry.type])).toEqual([[waiting.mint.toBase58(), "settle"], [waiting.mint.toBase58(), "pay_payee"]]);
    expect(s.outcomes[0]).toMatchObject({ skipped: "nothing to do" });
  });

  it("never creates the payee ATA: the share waits in PayeePot", async () => {
    const c = coin();
    const w = world(seed(c, 10_000n, 0n, false));
    const s = await settleTick(deps(w), config, [c]);
    expect(w.sent.map((x) => x.entry.type)).toEqual(["collect_creator_fee", "settle"]);
    expect(s.outcomes[0]!.paid).toBeUndefined();
  });

  it("Holders-mode and treasury-only coins are never paid out by this loop", async () => {
    const h = coin({ payeeMode: "holders", payee: PublicKey.default }), t = coin({ treasuryOnly: true });
    const w = world(new Map([...seed(h, 10_000n), ...seed(t, 10_000n)]));
    await settleTick(deps(w), config, [h, t]);
    expect(w.sent.map((x) => x.entry.type)).toEqual(["collect_creator_fee", "settle", "collect_creator_fee", "settle"]);
    expect(w.sent[3]!.entry.amounts).toEqual({ fee: "10000", liquidity: "0", buyback: "0", operator: "10000", deployer: "0" });
  });

  it("skips paused coins, and idles entirely when the vault is paused", async () => {
    const p = coin({ paused: true }), ok = coin();
    const w = world(new Map([...seed(p, 10_000n), ...seed(ok, 10_000n)]));
    const s = await settleTick(deps(w), config, [p, ok]);
    expect(s.outcomes[0]).toMatchObject({ skipped: "coin paused" });
    expect(w.sent.every((x) => x.entry.mint === ok.mint.toBase58())).toBe(true);
    const w2 = world(seed(ok, 10_000n));
    const s2 = await settleTick(deps(w2), { ...config, paused: true }, [ok]);
    expect(w2.sent).toHaveLength(0);
    expect(s2.outcomes[0]).toMatchObject({ skipped: "vault paused" });
  });

  it("one coin failing never blocks the others; the failure is in the summary", async () => {
    const bad = coin(), good = coin();
    const w = world(new Map([...seed(bad, 10_000n), ...seed(good, 10_000n)]), [bad.mint.toBase58()]);
    const s = await settleTick(deps(w), config, [bad, good]);
    expect(s.failed).toBe(1);
    expect(s.outcomes[0]!.error).toMatch(/rpc down/);
    expect(w.sent.filter((x) => x.entry.mint === good.mint.toBase58()).map((x) => x.entry.type)).toEqual(["collect_creator_fee", "settle", "pay_payee"]);
  });

  it("flags a graduated coin's PumpSwap vault balance without touching it (M6)", async () => {
    const c = coin();
    const m = seed(c, 0n);
    m.set(ata(ammCreatorVaultPda(coinFeePda(c.mint)[0])).toBase58(), 7_777n);
    const lines: string[] = [];
    const w = world(m);
    await settleTick({ ...deps(w), log: createLogger({}, "warn", (l) => lines.push(l)) }, config, [c]);
    expect(lines.some((l) => l.includes("PumpSwap") && l.includes("7777"))).toBe(true);
    expect(w.sent).toHaveLength(0);
  });
});

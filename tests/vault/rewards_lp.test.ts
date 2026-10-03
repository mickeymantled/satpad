import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { createHash } from "node:crypto";
import { coinPda, configPda, lpPotPda, rewardsPotPda, rewardsRunPda } from "@satpad/sdk";
import { VaultSvm } from "./harness";
import { ataOf, createAta, declaredCoin, initialized, mintTo, wallets, type Wallets } from "./fixtures";

const hash = (s: string) => Array.from(createHash("sha256").update(s).digest());

describe("release_rewards", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;
  let mint: Keypair;
  const user = Keypair.generate();

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    v.airdrop(user.publicKey, 10_000_000_000n);
    mint = Keypair.generate();
    await declaredCoin(v, w, quoteMint, user, mint, { holders: {} });
    createAta(v, quoteMint, w.rewards.publicKey);
  });

  const pot = () => v.tokenAccount(rewardsPotPda(mint.publicKey)[0]).amount;
  const fund = (amt: bigint) => mintTo(v, quoteMint, rewardsPotPda(mint.publicKey)[0], amt);
  const releaseIx = (h: number[], opts: { signer?: PublicKey; runIndex?: bigint; ata?: PublicKey } = {}) => {
    const idx = opts.runIndex ?? BigInt(v.decode<{ rewards_run_count: BN }>("Coin", coinPda(mint.publicKey)[0]).rewards_run_count.toString());
    return v.program.methods["releaseRewards"]!(h).accounts({
      rewardsWallet: opts.signer ?? w.rewards.publicKey, config: configPda()[0], mint: mint.publicKey, coin: coinPda(mint.publicKey)[0],
      rewardsRun: rewardsRunPda(mint.publicKey, idx)[0], rewardsPot: rewardsPotPda(mint.publicKey)[0],
      rewardsAta: opts.ata ?? ataOf(quoteMint, w.rewards.publicKey), quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  };

  it("writes RewardsRun with the hash, moves the whole pot to the rewards wallet, bumps the counter", async () => {
    fund(50_000n);
    const h = hash("snapshot-0");
    const before = v.now();
    v.send([await releaseIx(h)], [w.rewards]);
    expect(pot()).toBe(0n);
    expect(v.tokenAccount(ataOf(quoteMint, w.rewards.publicKey)).amount).toBe(50_000n);
    const run = v.decode<Record<string, unknown>>("RewardsRun", rewardsRunPda(mint.publicKey, 0n)[0]);
    expect((run["mint"] as PublicKey).equals(mint.publicKey)).toBe(true);
    expect((run["run_index"] as BN).toNumber()).toBe(0);
    expect(run["snapshot_sha256"]).toEqual(h);
    expect((run["amount_released"] as BN).toString()).toBe("50000");
    expect(BigInt((run["timestamp"] as BN).toString())).toBe(before);
    const c = v.decode<Record<string, BN>>("Coin", coinPda(mint.publicKey)[0]);
    expect(c["rewards_run_count"]!.toNumber()).toBe(1);
    expect(BigInt(c["last_rewards_run_ts"]!.toString())).toBe(before);
  });

  it("refuses a second run within 3600 s, allows it after, with run_index 1 at a distinct PDA", async () => {
    fund(50_000n);
    v.send([await releaseIx(hash("a"))], [w.rewards]);
    fund(50_000n);
    v.warp(3_599n);
    v.expectFail([await releaseIx(hash("b"))], [w.rewards], "RewardsTooSoon");
    v.warp(1n);
    v.send([await releaseIx(hash("b"))], [w.rewards]);
    const run1 = v.decode<Record<string, unknown>>("RewardsRun", rewardsRunPda(mint.publicKey, 1n)[0]);
    expect((run1["run_index"] as BN).toNumber()).toBe(1);
    expect(run1["snapshot_sha256"]).toEqual(hash("b"));
    expect(rewardsRunPda(mint.publicKey, 0n)[0].equals(rewardsRunPda(mint.publicKey, 1n)[0])).toBe(false);
  });

  it("refuses a pot below REWARDS_MIN_RELEASE and an empty pot", async () => {
    v.expectFail([await releaseIx(hash("x"))], [w.rewards], "RewardsPotBelowMin");
    fund(999n);
    v.expectFail([await releaseIx(hash("x"))], [w.rewards], "RewardsPotBelowMin");
    fund(1n);
    v.send([await releaseIx(hash("x"))], [w.rewards]);
  });

  it("refuses a Wallet-mode coin", async () => {
    mint = Keypair.generate();
    await declaredCoin(v, w, quoteMint, user, mint);
    fund(50_000n);
    v.expectFail([await releaseIx(hash("x"))], [w.rewards], "NotHoldersMode");
  });

  it("refuses any signer but the rewards wallet, and any destination but its ATA", async () => {
    fund(50_000n);
    for (const k of [w.admin, w.lp, w.treasury, user]) {
      v.expectFail([await releaseIx(hash("x"), { signer: k.publicKey })], [k], "NotRewardsWallet");
    }
    const evil = createAta(v, quoteMint, Keypair.generate().publicKey);
    const ix = await releaseIx(hash("x"), { ata: evil });
    expect(() => v.send([ix], [w.rewards])).toThrow();
    expect(pot()).toBe(50_000n);
  });

  it("refuses a RewardsRun at the wrong index (cannot skip or replay)", async () => {
    fund(50_000n);
    const ix = await releaseIx(hash("x"), { runIndex: 1n });
    expect(() => v.send([ix], [w.rewards])).toThrow();
  });
});

describe("draw_lp", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    createAta(v, quoteMint, w.lp.publicKey);
    mintTo(v, quoteMint, lpPotPda()[0], 10_000_000n);
  });

  const pot = () => v.tokenAccount(lpPotPda()[0]).amount;
  const drawIx = (amount: bigint, opts: { signer?: PublicKey; ata?: PublicKey } = {}) =>
    v.program.methods["drawLp"]!(new BN(amount.toString())).accounts({
      lpWallet: opts.signer ?? w.lp.publicKey, config: configPda()[0], lpPot: lpPotPda()[0], lpAta: opts.ata ?? ataOf(quoteMint, w.lp.publicKey),
      quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();

  it("draws up to lp_draw_max to the LP wallet and stamps last_lp_draw_ts", async () => {
    const t = v.now();
    v.send([await drawIx(500_000n)], [w.lp]);
    expect(pot()).toBe(9_500_000n);
    expect(v.tokenAccount(ataOf(quoteMint, w.lp.publicKey)).amount).toBe(500_000n);
    expect(BigInt(v.decode<{ last_lp_draw_ts: BN }>("Config", configPda()[0]).last_lp_draw_ts.toString())).toBe(t);
  });

  it("refuses above lp_draw_max and zero", async () => {
    v.expectFail([await drawIx(500_001n)], [w.lp], "LpDrawTooLarge");
    v.expectFail([await drawIx(0n)], [w.lp], "ZeroAmount");
    expect(pot()).toBe(10_000_000n);
  });

  it("enforces the interval exactly", async () => {
    v.send([await drawIx(1_000n)], [w.lp]);
    v.warp(299n);
    v.expectFail([await drawIx(1_000n)], [w.lp], "LpDrawTooSoon");
    v.warp(1n);
    v.send([await drawIx(1_000n)], [w.lp]);
    expect(pot()).toBe(9_998_000n);
  });

  it("refuses every other key, including admin and rewards wallet, and any other destination", async () => {
    for (const k of [w.admin, w.rewards, w.treasury, w.buyback]) {
      v.expectFail([await drawIx(1_000n, { signer: k.publicKey })], [k], "NotLpWallet");
    }
    const evil = createAta(v, quoteMint, Keypair.generate().publicKey);
    const ix = await drawIx(1_000n, { ata: evil });
    expect(() => v.send([ix], [w.lp])).toThrow();
    expect(pot()).toBe(10_000_000n);
  });

  it("a stolen LP key moves at most lp_draw_max per interval", async () => {
    v.send([await drawIx(500_000n)], [w.lp]);
    v.expectFail([await drawIx(1n)], [w.lp], "LpDrawTooSoon");
    expect(v.tokenAccount(ataOf(quoteMint, w.lp.publicKey)).amount).toBe(500_000n);
  });
});

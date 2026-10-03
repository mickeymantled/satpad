import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_SPLIT, coinPda, configPda, lpPotPda, payeePotPda, rewardsPotPda, splitFee } from "@satpad/sdk";
import { VaultSvm } from "./harness";
import { ataOf, createAta, declaredCoin, initialized, mintTo, patchAccountAsync, settleIx, wallets, type Wallets } from "./fixtures";

describe("settle", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;
  let user: Keypair;
  let mint: Keypair;
  let feeAta: PublicKey;

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    user = Keypair.generate();
    v.airdrop(user.publicKey, 10_000_000_000n);
    mint = Keypair.generate();
    feeAta = await declaredCoin(v, w, quoteMint, user, mint);
    createAta(v, quoteMint, w.buyback.publicKey);
    createAta(v, quoteMint, w.treasury.publicKey);
  });

  const balances = () => ({
    fee: v.tokenAccount(feeAta).amount,
    liquidity: v.tokenAccount(lpPotPda()[0]).amount,
    buyback: v.tokenAccount(ataOf(quoteMint, w.buyback.publicKey)).amount,
    operator: v.tokenAccount(ataOf(quoteMint, w.treasury.publicKey)).amount,
    payeePot: v.tokenAccount(payeePotPda(mint.publicKey)[0]).amount,
    rewardsPot: v.tokenAccount(rewardsPotPda(mint.publicKey)[0]).amount,
  });

  it("splits 10000 base units exactly by the default split into the four destinations", async () => {
    mintTo(v, quoteMint, feeAta, 10_000n);
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    expect(balances()).toEqual({ fee: 0n, liquidity: 2_500n, buyback: 2_500n, operator: 1_000n, payeePot: 4_000n, rewardsPot: 0n });
  });

  it("matches @satpad/sdk splitFee at every edge amount, cumulatively (D7: remainder to liquidity)", async () => {
    const amounts = [1n, 2n, 3n, 7n, 9_999n, 10_001n, 123_456_789n, 2n ** 40n + 13n];
    let expected = { liquidity: 0n, buyback: 0n, operator: 0n, deployer: 0n };
    for (const a of amounts) {
      mintTo(v, quoteMint, feeAta, a);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      const s = splitFee(a, DEFAULT_SPLIT);
      expected = { liquidity: expected.liquidity + s.liquidity, buyback: expected.buyback + s.buyback, operator: expected.operator + s.operator, deployer: expected.deployer + s.deployer };
      const b = balances();
      expect(b.fee).toBe(0n);
      expect({ liquidity: b.liquidity, buyback: b.buyback, operator: b.operator, deployer: b.payeePot }).toEqual(expected);
    }
    // 1 base unit went entirely to liquidity; 3 gave 2 to liquidity and 1 to deployer
    expect(splitFee(1n, DEFAULT_SPLIT).liquidity).toBe(1n);
  });

  it("is a no-op with an empty CoinFee ATA", async () => {
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    expect(balances().liquidity).toBe(0n);
  });

  it("anyone can call it", async () => {
    mintTo(v, quoteMint, feeAta, 10_000n);
    const stranger = Keypair.generate();
    v.airdrop(stranger.publicKey, 1_000_000_000n);
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [stranger]);
    expect(balances().fee).toBe(0n);
  });

  it("routes the deployer share to RewardsPot for a Holders-mode coin", async () => {
    mint = Keypair.generate();
    feeAta = await declaredCoin(v, w, quoteMint, user, mint, { holders: {} });
    mintTo(v, quoteMint, feeAta, 10_000n);
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    expect(balances()).toMatchObject({ payeePot: 0n, rewardsPot: 4_000n, liquidity: 2_500n });
  });

  it("sends 100% to the treasury for a treasury-only ($SATPAD) coin", async () => {
    mint = Keypair.generate();
    feeAta = await declaredCoin(v, w, quoteMint, user, mint, { me: {} }, true);
    mintTo(v, quoteMint, feeAta, 10_000n);
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    expect(balances()).toEqual({ fee: 0n, liquidity: 0n, buyback: 0n, operator: 10_000n, payeePot: 0n, rewardsPot: 0n });
  });

  it("applies the split in force at settle time, including to fees already waiting", async () => {
    mintTo(v, quoteMint, feeAta, 10_000n);
    await patchAccountAsync(v, "Config", configPda()[0], { split: { liquidity_bps: 5000, buyback_bps: 2000, operator_bps: 2000, deployer_bps: 1000 } });
    v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    expect(balances()).toMatchObject({ liquidity: 5_000n, buyback: 2_000n, operator: 2_000n, payeePot: 1_000n });
  });

  it("refuses while the vault or the coin is paused; the fee stays put", async () => {
    mintTo(v, quoteMint, feeAta, 10_000n);
    await patchAccountAsync(v, "Config", configPda()[0], { paused: true });
    v.expectFail([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer], "Paused");
    await patchAccountAsync(v, "Config", configPda()[0], { paused: false });
    await patchAccountAsync(v, "Coin", coinPda(mint.publicKey)[0], { paused: true });
    v.expectFail([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer], "CoinPaused");
    expect(balances().fee).toBe(10_000n);
  });

  it("refuses substituted destination accounts", async () => {
    mintTo(v, quoteMint, feeAta, 10_000n);
    const attacker = Keypair.generate().publicKey;
    const evilAta = createAta(v, quoteMint, attacker);
    for (const field of ["buybackAta", "treasuryAta", "lpPot", "payeePot", "rewardsPot", "coinFeeAta"]) {
      const ix = await settleIx(v, w, quoteMint, mint.publicKey, { [field]: evilAta });
      expect(() => v.send([ix], [v.payer]), field).toThrow();
    }
    expect(balances().fee).toBe(10_000n);
    expect(v.tokenAccount(evilAta).amount).toBe(0n);
  });

  it("refuses when a destination ATA does not exist (never creates one)", async () => {
    mint = Keypair.generate();
    v = new VaultSvm(); w = wallets(); quoteMint = await initialized(v, w);
    v.airdrop(user.publicKey, 10_000_000_000n);
    feeAta = await declaredCoin(v, w, quoteMint, user, mint);
    mintTo(v, quoteMint, feeAta, 10_000n);
    const ix = await settleIx(v, w, quoteMint, mint.publicKey);
    expect(() => v.send([ix], [v.payer])).toThrow();
  });
});

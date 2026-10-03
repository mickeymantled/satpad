import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { PUMP_PROGRAM_ID, coinFeeAta, coinFeePda, coinPda, configPda, payeePotPda, rewardsPotPda } from "@satpad/sdk";
import { VaultSvm } from "./harness";
import { LAUNCH_FEE, injectCurve, initialized, wallets, type Wallets } from "./fixtures";

describe("declare_coin", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;
  let user: Keypair;
  let mint: Keypair;

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    user = Keypair.generate();
    v.airdrop(user.publicKey, 10_000_000_000n);
    mint = Keypair.generate();
  });

  type Payee = { me: object } | { wallet: [PublicKey] } | { holders: object };
  const declareIx = (payee: Payee = { me: {} }, treasuryOnly = false, opts: { user?: PublicKey; treasury?: PublicKey; quoteMint?: PublicKey } = {}) =>
    v.program.methods["declareCoin"]!(payee, treasuryOnly).accounts({
      user: opts.user ?? user.publicKey, mint: mint.publicKey, config: configPda()[0], treasury: opts.treasury ?? w.treasury.publicKey,
      bondingCurve: bondingCurvePda(mint.publicKey), coin: coinPda(mint.publicKey)[0], coinFee: coinFeePda(mint.publicKey)[0],
      coinFeeAta: coinFeeAta(mint.publicKey), payeePot: payeePotPda(mint.publicKey)[0], rewardsPot: rewardsPotPda(mint.publicKey)[0],
      quoteMint: opts.quoteMint ?? quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction();

  // coinFeeAta in the SDK is derived with BTC_QUOTE_MINT; here the quote mint is a test mint, so derive the ATA against it.
  const ata = (m: PublicKey, q = quoteMint) => PublicKey.findProgramAddressSync([coinFeePda(m)[0].toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), q.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  const declareIxFixed = async (payee: Payee = { me: {} }, treasuryOnly = false, opts: Parameters<typeof declareIx>[2] = {}) => {
    const ix = await declareIx(payee, treasuryOnly, opts);
    const k = ix.keys.find((k) => k.pubkey.equals(coinFeeAta(mint.publicKey)))!;
    k.pubkey = ata(mint.publicKey, opts.quoteMint ?? quoteMint);
    return ix;
  };

  it("registers a coin whose curve creator is CoinFee: writes Coin, creates the fee ATA and both pots, takes the launch fee", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    const treasuryBefore = v.lamportsOf(w.treasury.publicKey);
    v.send([await declareIxFixed()], [user, mint]);

    const c = v.decode<Record<string, unknown>>("Coin", coinPda(mint.publicKey)[0]);
    expect((c["mint"] as PublicKey).equals(mint.publicKey)).toBe(true);
    expect((c["deployer"] as PublicKey).equals(user.publicKey)).toBe(true);
    expect((c["payee"] as PublicKey).equals(user.publicKey)).toBe(true); // Me
    expect(c["payee_mode"]).toEqual({ Wallet: {} });
    expect(c["declared"]).toBe(true);
    expect(c["paused"]).toBe(false);
    expect(c["treasury_only"]).toBe(false);
    expect((c["created_at"] as BN).toNumber()).toBeGreaterThan(0);
    expect(c["bump"]).toBe(coinPda(mint.publicKey)[1]);
    expect(c["coin_fee_bump"]).toBe(coinFeePda(mint.publicKey)[1]);

    const feeAta = v.tokenAccount(ata(mint.publicKey));
    expect(feeAta.owner.equals(coinFeePda(mint.publicKey)[0])).toBe(true);
    expect(feeAta.mint.equals(quoteMint)).toBe(true);
    for (const pot of [payeePotPda(mint.publicKey)[0], rewardsPotPda(mint.publicKey)[0]]) {
      const t = v.tokenAccount(pot);
      expect(t.owner.equals(configPda()[0])).toBe(true);
      expect(t.mint.equals(quoteMint)).toBe(true);
      expect(t.amount).toBe(0n);
    }
    expect(v.lamportsOf(w.treasury.publicKey) - treasuryBefore).toBe(LAUNCH_FEE);
  });

  it("records Wallet and Holders payee choices", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    const other = Keypair.generate().publicKey;
    v.send([await declareIxFixed({ wallet: [other] })], [user, mint]);
    let c = v.decode<Record<string, unknown>>("Coin", coinPda(mint.publicKey)[0]);
    expect((c["payee"] as PublicKey).equals(other)).toBe(true);
    expect(c["payee_mode"]).toEqual({ Wallet: {} });

    mint = Keypair.generate();
    injectCurve(v, mint.publicKey, { quoteMint });
    v.send([await declareIxFixed({ holders: {} })], [user, mint]);
    c = v.decode<Record<string, unknown>>("Coin", coinPda(mint.publicKey)[0]);
    expect(c["payee_mode"]).toEqual({ Holders: {} });
    expect((c["payee"] as PublicKey).equals(PublicKey.default)).toBe(true);
  });

  it("refuses a second declaration of the same mint", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    v.send([await declareIxFixed()], [user, mint]);
    const again = await declareIxFixed();
    expect(() => v.send([again], [user, mint])).toThrow();
  });

  it("refuses without the mint keypair signature", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    const ix = await declareIxFixed();
    expect(() => v.send([ix], [user])).toThrow(/signature|Signature/);
  });

  it("refuses a curve whose creator is not CoinFee", async () => {
    injectCurve(v, mint.publicKey, { quoteMint, creator: Keypair.generate().publicKey });
    v.expectFail([await declareIxFixed()], [user, mint], "WrongCurveCreator");
  });

  it("refuses a curve quoted in anything but the configured quote mint (SOL default and another token)", async () => {
    injectCurve(v, mint.publicKey, { quoteMint: PublicKey.default });
    v.expectFail([await declareIxFixed()], [user, mint], "WrongCurveQuoteMint");
    injectCurve(v, mint.publicKey, { quoteMint: Keypair.generate().publicKey });
    v.expectFail([await declareIxFixed()], [user, mint], "WrongCurveQuoteMint");
  });

  it("refuses a creator fee that is not exactly Config.creator_fee_bps (D9)", async () => {
    for (const bps of [0n, 99n, 101n, 300n]) {
      injectCurve(v, mint.publicKey, { quoteMint, creatorFeeBps: bps });
      v.expectFail([await declareIxFixed()], [user, mint], "CreatorFeeMismatch");
    }
  });

  it("refuses holder-reward and mayhem curves", async () => {
    injectCurve(v, mint.publicKey, { quoteMint, isHolderReward: true });
    v.expectFail([await declareIxFixed()], [user, mint], "HolderRewardCurve");
    injectCurve(v, mint.publicKey, { quoteMint, isMayhemMode: true });
    v.expectFail([await declareIxFixed()], [user, mint], "MayhemCurve");
  });

  it("refuses when the bonding curve account is missing, not pump-owned, or malformed", async () => {
    const ix = await declareIxFixed();
    expect(() => v.send([ix], [user, mint])).toThrow(); // missing
    v.setAccount(bondingCurvePda(mint.publicKey), SystemProgram.programId, Buffer.alloc(125));
    v.expectFail([await declareIxFixed()], [user, mint], "BadCurveData"); // wrong owner
    const good = injectCurve(v, mint.publicKey, { quoteMint });
    const bad = Buffer.from(v.accountData(good)!);
    bad.writeUInt8(bad.readUInt8(0) ^ 0xff, 0); // break discriminator
    v.setAccount(good, PUMP_PROGRAM_ID, bad);
    v.expectFail([await declareIxFixed()], [user, mint], "BadCurveData");
  });

  it("refuses a treasury account other than Config.treasury and a foreign quote mint", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    v.expectFail([await declareIxFixed({ me: {} }, false, { treasury: Keypair.generate().publicKey })], [user, mint], "WrongTreasury");
    v.expectFail([await declareIxFixed({ me: {} }, false, { quoteMint: v.createMint(8) })], [user, mint], "WrongQuoteMint");
  });

  it("treasury_only needs the admin as the launcher", async () => {
    injectCurve(v, mint.publicKey, { quoteMint });
    v.expectFail([await declareIxFixed({ me: {} }, true)], [user, mint], "NotAdmin");
    v.send([await declareIxFixed({ me: {} }, true, { user: w.admin.publicKey })], [w.admin, mint]);
    expect(v.decode<{ treasury_only: boolean }>("Coin", coinPda(mint.publicKey)[0]).treasury_only).toBe(true);
  });

  it("skips the launch fee transfer when Config.launch_fee_lamports is 0", async () => {
    v = new VaultSvm(); w = wallets();
    quoteMint = await initialized(v, w, { launchFeeLamports: new BN(0) });
    v.airdrop(user.publicKey, 10_000_000_000n);
    injectCurve(v, mint.publicKey, { quoteMint });
    const before = v.lamportsOf(w.treasury.publicKey);
    v.send([await declareIxFixed()], [user, mint]);
    expect(v.lamportsOf(w.treasury.publicKey)).toBe(before);
  });
});

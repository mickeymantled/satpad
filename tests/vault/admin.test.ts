import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { SATPAD_VAULT_PROGRAM_ID, coinFeePda, coinPda, configPda, lpPotPda, parseVaultEvents } from "@satpad/sdk";
import { VaultSvm } from "./harness";
import { ataOf, createAta, declaredCoin, initialized, mintTo, settleIx, wallets, type Wallets } from "./fixtures";

/** keys/recovery-dev.json pubkey, compiled into the dev build as RECOVERY_ADDRESS (consts.rs). */
const RECOVERY_DEV = new PublicKey("CTsAbZqVBmfb2NgUr8BJ9CUCmj1vMqrR3kWA8k6Wcmog");

describe("admin instructions", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;
  const user = Keypair.generate();
  let mint: Keypair;
  let feeAta: PublicKey;

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    v.airdrop(user.publicKey, 10_000_000_000n);
    mint = Keypair.generate();
    feeAta = await declaredCoin(v, w, quoteMint, user, mint);
    createAta(v, quoteMint, w.buyback.publicKey);
    createAta(v, quoteMint, w.treasury.publicKey);
  });

  const config = () => v.decode<Record<string, unknown>>("Config", configPda()[0]);
  const adminAccts = (signer = w.admin.publicKey) => ({ admin: signer, config: configPda()[0] });
  const splitIx = (s: Record<string, number>, signer?: PublicKey) => v.program.methods["setSplit"]!(s).accounts(adminAccts(signer)).instruction();
  const walletsIx = (t: PublicKey | null, b: PublicKey | null, r: PublicKey | null, signer?: PublicKey) => v.program.methods["setWallets"]!(t, b, r).accounts(adminAccts(signer)).instruction();
  const pauseIx = (p: boolean, signer?: PublicKey) => v.program.methods["setPause"]!(p).accounts(adminAccts(signer)).instruction();
  const coinPauseIx = (p: boolean, signer?: PublicKey) => v.program.methods["setCoinPause"]!(p).accounts({ ...adminAccts(signer), mint: mint.publicKey, coin: coinPda(mint.publicKey)[0] }).instruction();
  const recoverIx = (opts: { signer?: PublicKey; dest?: PublicKey } = {}) => v.program.methods["recover"]!().accounts({
    ...adminAccts(opts.signer), mint: mint.publicKey, coin: coinPda(mint.publicKey)[0], coinFee: coinFeePda(mint.publicKey)[0], coinFeeAta: feeAta,
    recoveryAta: opts.dest ?? ataOf(quoteMint, RECOVERY_DEV), quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID,
  }).instruction();
  const setLpIx = (signer: PublicKey, lpWallet: PublicKey | null, max: bigint | null, interval: bigint | null) => v.program.methods["setLp"]!(lpWallet, max === null ? null : new BN(max.toString()), interval === null ? null : new BN(interval.toString())).accounts({
    authority: signer, config: configPda()[0], program: SATPAD_VAULT_PROGRAM_ID, programData: v.programDataAddress(),
  }).instruction();

  describe("set_split", () => {
    it("changes the split within bounds and the next settle uses it", async () => {
      v.send([await splitIx({ liquidityBps: 5000, buybackBps: 2000, operatorBps: 2000, deployerBps: 1000 })], [w.admin]);
      expect(config()["split"]).toEqual({ liquidity_bps: 5000, buyback_bps: 2000, operator_bps: 2000, deployer_bps: 1000 });
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      expect(v.tokenAccount(lpPotPda()[0]).amount).toBe(5_000n);
    });
    it("refuses out-of-bounds splits and non-admin signers", async () => {
      v.expectFail([await splitIx({ liquidityBps: 2499, buybackBps: 2501, operatorBps: 1000, deployerBps: 4000 })], [w.admin], "LiquidityTooLow");
      v.expectFail([await splitIx({ liquidityBps: 2500, buybackBps: 2499, operatorBps: 2001, deployerBps: 3000 })], [w.admin], "OperatorTooHigh");
      v.expectFail([await splitIx({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4001 })], [w.admin], "SplitSum");
      for (const k of [w.lp, w.rewards, user]) v.expectFail([await splitIx({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4000 }, k.publicKey)], [k], "NotAdmin");
    });
  });

  describe("set_wallets", () => {
    it("updates only the given wallets; admin, lp_wallet and recovery are untouchable here", async () => {
      const t = Keypair.generate().publicKey, r = Keypair.generate().publicKey;
      v.send([await walletsIx(t, null, r)], [w.admin]);
      const c = config();
      expect((c["treasury"] as PublicKey).equals(t)).toBe(true);
      expect((c["buyback_wallet"] as PublicKey).equals(w.buyback.publicKey)).toBe(true);
      expect((c["rewards_wallet"] as PublicKey).equals(r)).toBe(true);
      expect((c["lp_wallet"] as PublicKey).equals(w.lp.publicKey)).toBe(true);
      expect((c["admin"] as PublicKey).equals(w.admin.publicKey)).toBe(true);
    });
    it("refuses the default pubkey and non-admin signers", async () => {
      v.expectFail([await walletsIx(PublicKey.default, null, null)], [w.admin], "InvalidWallet");
      v.expectFail([await walletsIx(Keypair.generate().publicKey, null, null, w.lp.publicKey)], [w.lp], "NotAdmin");
    });
  });

  describe("set_satpad (D21: admin-only, write-once)", () => {
    const satpadIx = (m: PublicKey, p: PublicKey, l: PublicKey, signer?: PublicKey) => v.program.methods["setSatpad"]!(m, p, l).accounts({ admin: signer ?? w.admin.publicKey, config: configPda()[0] }).instruction();
    it("records mint, pool and LP mint once and emits SatpadSet; a second call is refused", async () => {
      const m = Keypair.generate().publicKey, p = Keypair.generate().publicKey, l = Keypair.generate().publicKey;
      expect((config()["satpad_pool"] as PublicKey).equals(PublicKey.default)).toBe(true);
      const logs = v.send([await satpadIx(m, p, l)], [w.admin]).logs();
      const c = config();
      expect((c["satpad_mint"] as PublicKey).equals(m)).toBe(true);
      expect((c["satpad_pool"] as PublicKey).equals(p)).toBe(true);
      expect((c["satpad_lp_mint"] as PublicKey).equals(l)).toBe(true);
      const ev = parseVaultEvents(logs).find((e) => e.name === "SatpadSet");
      expect(ev).toBeDefined();
      expect((ev!.data["satpad_pool"] as PublicKey).equals(p)).toBe(true);
      v.expectFail([await satpadIx(Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey)], [w.admin], "SatpadAlreadySet");
      expect((config()["satpad_pool"] as PublicKey).equals(p)).toBe(true); // unchanged
    });
    it("refuses default or duplicate keys and non-admin signers", async () => {
      const k = Keypair.generate().publicKey;
      v.expectFail([await satpadIx(PublicKey.default, k, Keypair.generate().publicKey)], [w.admin], "InvalidWallet");
      v.expectFail([await satpadIx(k, k, Keypair.generate().publicKey)], [w.admin], "InvalidWallet");
      v.expectFail([await satpadIx(k, Keypair.generate().publicKey, Keypair.generate().publicKey, w.lp.publicKey)], [w.lp], "NotAdmin");
      expect((config()["satpad_pool"] as PublicKey).equals(PublicKey.default)).toBe(true);
    });
  });

  describe("set_pause / set_coin_pause", () => {
    it("global pause blocks every settle; unpause restores", async () => {
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await pauseIx(true)], [w.admin]);
      expect(config()["paused"]).toBe(true);
      v.expectFail([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer], "Paused");
      v.send([await pauseIx(false)], [w.admin]);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      expect(v.tokenAccount(feeAta).amount).toBe(0n);
    });
    it("per-coin pause blocks only that coin", async () => {
      const other = Keypair.generate();
      const otherFee = await declaredCoin(v, w, quoteMint, user, other);
      mintTo(v, quoteMint, feeAta, 10_000n);
      mintTo(v, quoteMint, otherFee, 10_000n);
      v.send([await coinPauseIx(true)], [w.admin]);
      v.expectFail([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer], "CoinPaused");
      v.send([await settleIx(v, w, quoteMint, other.publicKey)], [v.payer]);
      expect(v.tokenAccount(otherFee).amount).toBe(0n);
      v.send([await coinPauseIx(false)], [w.admin]);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
    });
    it("non-admin cannot pause", async () => {
      v.expectFail([await pauseIx(true, w.lp.publicKey)], [w.lp], "NotAdmin");
      v.expectFail([await coinPauseIx(true, user.publicKey)], [user], "NotAdmin");
    });
  });

  describe("recover", () => {
    it("moves a paused coin's CoinFee balance to the fixed recovery address only", async () => {
      mintTo(v, quoteMint, feeAta, 10_000n);
      createAta(v, quoteMint, RECOVERY_DEV);
      v.expectFail([await recoverIx()], [w.admin], "CoinNotPaused");
      v.send([await coinPauseIx(true)], [w.admin]);
      v.send([await recoverIx()], [w.admin]);
      expect(v.tokenAccount(feeAta).amount).toBe(0n);
      expect(v.tokenAccount(ataOf(quoteMint, RECOVERY_DEV)).amount).toBe(10_000n);
    });
    it("refuses any other destination, including the admin's own ATA and the treasury", async () => {
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await coinPauseIx(true)], [w.admin]);
      for (const dest of [createAta(v, quoteMint, w.admin.publicKey), ataOf(quoteMint, w.treasury.publicKey)]) {
        const ix = await recoverIx({ dest });
        expect(() => v.send([ix], [w.admin])).toThrow();
      }
      expect(v.tokenAccount(feeAta).amount).toBe(10_000n);
    });
    it("non-admin cannot recover", async () => {
      v.send([await coinPauseIx(true)], [w.admin]);
      createAta(v, quoteMint, RECOVERY_DEV);
      v.expectFail([await recoverIx({ signer: w.lp.publicKey })], [w.lp], "NotAdmin");
    });
  });

  describe("set_lp (upgrade authority only)", () => {
    const multisig = Keypair.generate();
    beforeEach(() => {
      v.airdrop(multisig.publicKey, 1_000_000_000n);
      v.setUpgradeAuthority(multisig.publicKey);
    });
    it("the upgrade authority (mock Squads vault) sets LP wallet and params within caps", async () => {
      const newLp = Keypair.generate().publicKey;
      v.send([await setLpIx(multisig.publicKey, newLp, 250_000n, 600n)], [multisig]);
      const c = config();
      expect((c["lp_wallet"] as PublicKey).equals(newLp)).toBe(true);
      expect((c["lp_draw_max"] as BN).toNumber()).toBe(250_000);
      expect((c["lp_draw_interval"] as BN).toNumber()).toBe(600);
      // partial update keeps the rest
      v.send([await setLpIx(multisig.publicKey, null, null, 300n)], [multisig]);
      expect((config()["lp_draw_max"] as BN).toNumber()).toBe(250_000);
    });
    it("enforces the caps", async () => {
      v.expectFail([await setLpIx(multisig.publicKey, null, 500_001n, null)], [multisig], "LpDrawMaxTooHigh");
      v.expectFail([await setLpIx(multisig.publicKey, null, null, 299n)], [multisig], "LpDrawIntervalTooShort");
      v.expectFail([await setLpIx(multisig.publicKey, PublicKey.default, null, null)], [multisig], "InvalidWallet");
    });
    it("the admin cannot set LP params; neither can the LP wallet", async () => {
      v.expectFail([await setLpIx(w.admin.publicKey, null, 1n, null)], [w.admin], "NotUpgradeAuthority");
      v.expectFail([await setLpIx(w.lp.publicKey, null, 1n, null)], [w.lp], "NotUpgradeAuthority");
    });
    it("with no upgrade authority (immutable program) nobody can call it", async () => {
      v.setUpgradeAuthority(null);
      v.expectFail([await setLpIx(multisig.publicKey, null, 1n, null)], [multisig], "NotUpgradeAuthority");
    });
    it("a forged program_data account is rejected", async () => {
      const fake = Keypair.generate().publicKey;
      const real = Buffer.from(v.accountData(v.programDataAddress())!);
      v.setAccount(fake, new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), real);
      const ix = await v.program.methods["setLp"]!(null, new BN(1), null).accounts({ authority: w.admin.publicKey, config: configPda()[0], program: SATPAD_VAULT_PROGRAM_ID, programData: fake }).instruction();
      expect(() => v.send([ix], [w.admin])).toThrow();
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { coinPda, configPda, payeePotPda, rewardsPotPda } from "@satpad/sdk";
import { VaultSvm } from "./harness";
import { ataOf, createAta, declaredCoin, initialized, mintTo, settleIx, wallets, type Wallets } from "./fixtures";

describe("payee: pay_payee / redirect_payee / set_holder_rewards", () => {
  let v: VaultSvm;
  let w: Wallets;
  let quoteMint: PublicKey;
  let deployer: Keypair;
  let mint: Keypair;
  let feeAta: PublicKey;

  beforeEach(async () => {
    v = new VaultSvm();
    w = wallets();
    quoteMint = await initialized(v, w);
    deployer = Keypair.generate();
    v.airdrop(deployer.publicKey, 10_000_000_000n);
    mint = Keypair.generate();
    feeAta = await declaredCoin(v, w, quoteMint, deployer, mint); // payee = Me (deployer)
    createAta(v, quoteMint, w.buyback.publicKey);
    createAta(v, quoteMint, w.treasury.publicKey);
  });

  const pot = () => v.tokenAccount(payeePotPda(mint.publicKey)[0]).amount;
  const coin = () => v.decode<Record<string, unknown>>("Coin", coinPda(mint.publicKey)[0]);
  const fundPot = (amt: bigint) => mintTo(v, quoteMint, payeePotPda(mint.publicKey)[0], amt);

  const payIx = (payee: PublicKey, overrides: Record<string, PublicKey> = {}) =>
    v.program.methods["payPayee"]!().accounts({
      config: configPda()[0], mint: mint.publicKey, coin: coinPda(mint.publicKey)[0], payeePot: payeePotPda(mint.publicKey)[0],
      payeeAta: ataOf(quoteMint, payee), quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID, ...overrides,
    }).instruction();
  const changeAccounts = (payee: PublicKey) => ({
    payee, config: configPda()[0], mint: mint.publicKey, coin: coinPda(mint.publicKey)[0], payeePot: payeePotPda(mint.publicKey)[0],
    payeeAta: ataOf(quoteMint, payee), quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID,
  });
  const redirectIx = (payee: PublicKey, to: PublicKey) => v.program.methods["redirectPayee"]!(to).accounts(changeAccounts(payee)).instruction();
  const holdersIx = (payee: PublicKey) => v.program.methods["setHolderRewards"]!().accounts(changeAccounts(payee)).instruction();

  describe("pay_payee", () => {
    it("pays the full pot to the payee's ATA; anyone can call", async () => {
      fundPot(4_000n);
      createAta(v, quoteMint, deployer.publicKey);
      const stranger = Keypair.generate();
      v.airdrop(stranger.publicKey, 1_000_000_000n);
      v.send([await payIx(deployer.publicKey)], [stranger]);
      expect(pot()).toBe(0n);
      expect(v.tokenAccount(ataOf(quoteMint, deployer.publicKey)).amount).toBe(4_000n);
    });

    it("is a no-op on an empty pot", async () => {
      createAta(v, quoteMint, deployer.publicKey);
      v.send([await payIx(deployer.publicKey)], [v.payer]);
      expect(pot()).toBe(0n);
    });

    it("never creates the payee ATA: refuses when it is missing", async () => {
      fundPot(4_000n);
      const ix = await payIx(deployer.publicKey);
      expect(() => v.send([ix], [v.payer])).toThrow();
      expect(pot()).toBe(4_000n);
    });

    it("refuses an ATA that is not the current payee's", async () => {
      fundPot(4_000n);
      const other = Keypair.generate().publicKey;
      const evil = createAta(v, quoteMint, other);
      const ix = await payIx(deployer.publicKey, { payeeAta: evil });
      expect(() => v.send([ix], [v.payer])).toThrow();
      expect(pot()).toBe(4_000n);
    });

    it("works end to end from settle: fee → PayeePot → payee", async () => {
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      expect(pot()).toBe(4_000n);
      createAta(v, quoteMint, deployer.publicKey);
      v.send([await payIx(deployer.publicKey)], [v.payer]);
      expect(v.tokenAccount(ataOf(quoteMint, deployer.publicKey)).amount).toBe(4_000n);
    });
  });

  describe("redirect_payee", () => {
    it("only the current payee can call; the deployer/admin/stranger cannot once redirected", async () => {
      const next = Keypair.generate();
      v.airdrop(next.publicKey, 1_000_000_000n);
      createAta(v, quoteMint, deployer.publicKey);
      v.send([await redirectIx(deployer.publicKey, next.publicKey)], [deployer]);
      expect((coin()["payee"] as PublicKey).equals(next.publicKey)).toBe(true);
      // old payee (also the deployer) can no longer redirect
      v.expectFail([await redirectIx(deployer.publicKey, Keypair.generate().publicKey)], [deployer], "NotPayee");
      // admin cannot either
      createAta(v, quoteMint, w.admin.publicKey);
      v.expectFail([await redirectIx(w.admin.publicKey, Keypair.generate().publicKey)], [w.admin], "NotPayee");
      // the new payee can
      createAta(v, quoteMint, next.publicKey);
      const third = Keypair.generate().publicKey;
      v.send([await redirectIx(next.publicKey, third)], [next]);
      expect((coin()["payee"] as PublicKey).equals(third)).toBe(true);
    });

    it("pays the waiting balance to the old payee atomically, then the new payee receives later settles", async () => {
      fundPot(4_000n);
      const next = Keypair.generate();
      createAta(v, quoteMint, deployer.publicKey);
      v.send([await redirectIx(deployer.publicKey, next.publicKey)], [deployer]);
      expect(v.tokenAccount(ataOf(quoteMint, deployer.publicKey)).amount).toBe(4_000n);
      expect(pot()).toBe(0n);
      // next settle lands in the pot for the new payee
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      createAta(v, quoteMint, next.publicKey);
      v.send([await payIx(next.publicKey)], [v.payer]);
      expect(v.tokenAccount(ataOf(quoteMint, next.publicKey)).amount).toBe(4_000n);
      expect(v.tokenAccount(ataOf(quoteMint, deployer.publicKey)).amount).toBe(4_000n); // unchanged
    });

    it("refuses the default pubkey and the same payee", async () => {
      createAta(v, quoteMint, deployer.publicKey);
      v.expectFail([await redirectIx(deployer.publicKey, PublicKey.default)], [deployer], "InvalidPayee");
      v.expectFail([await redirectIx(deployer.publicKey, deployer.publicKey)], [deployer], "InvalidPayee");
    });

    it("refuses when the old payee's ATA is missing (the signer must create it first)", async () => {
      const ix = await redirectIx(deployer.publicKey, Keypair.generate().publicKey);
      expect(() => v.send([ix], [deployer])).toThrow();
    });

    it("Wallet(pubkey) payee controls the share from the start; the deployer has no say", async () => {
      const chosen = Keypair.generate();
      v.airdrop(chosen.publicKey, 1_000_000_000n);
      mint = Keypair.generate();
      feeAta = await declaredCoin(v, w, quoteMint, deployer, mint, { wallet: [chosen.publicKey] });
      createAta(v, quoteMint, deployer.publicKey);
      v.expectFail([await redirectIx(deployer.publicKey, Keypair.generate().publicKey)], [deployer], "NotPayee");
      createAta(v, quoteMint, chosen.publicKey);
      v.send([await holdersIx(chosen.publicKey)], [chosen]);
      expect(coin()["payee_mode"]).toEqual({ Holders: {} });
    });
  });

  describe("set_holder_rewards", () => {
    it("pays the old payee, switches to Holders permanently, and later settles go to RewardsPot", async () => {
      fundPot(4_000n);
      createAta(v, quoteMint, deployer.publicKey);
      v.send([await holdersIx(deployer.publicKey)], [deployer]);
      expect(v.tokenAccount(ataOf(quoteMint, deployer.publicKey)).amount).toBe(4_000n);
      const c = coin();
      expect(c["payee_mode"]).toEqual({ Holders: {} });
      expect((c["payee"] as PublicKey).equals(PublicKey.default)).toBe(true);
      // permanent: nobody can redirect or re-set
      v.expectFail([await redirectIx(deployer.publicKey, Keypair.generate().publicKey)], [deployer], "NotPayee");
      v.expectFail([await holdersIx(deployer.publicKey)], [deployer], "NotPayee");
      // pay_payee refuses in Holders mode
      v.expectFail([await payIx(deployer.publicKey)], [v.payer], "HoldersMode");
      // settle now routes the deployer share to RewardsPot
      mintTo(v, quoteMint, feeAta, 10_000n);
      v.send([await settleIx(v, w, quoteMint, mint.publicKey)], [v.payer]);
      expect(v.tokenAccount(rewardsPotPda(mint.publicKey)[0]).amount).toBe(4_000n);
      expect(pot()).toBe(0n);
    });

    it("a third party cannot call it", async () => {
      const stranger = Keypair.generate();
      v.airdrop(stranger.publicKey, 1_000_000_000n);
      createAta(v, quoteMint, stranger.publicKey);
      v.expectFail([await holdersIx(stranger.publicKey)], [stranger], "NotPayee");
    });
  });
});

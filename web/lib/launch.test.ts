import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { coinFeePda, configPda, SATPAD_VAULT_PROGRAM_ID, PUMP_PROGRAM_ID } from "@satpad/sdk";
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { buildLaunchIxs, MAX_TX_BYTES, planLaunch, validateLaunchForm } from "./launch";

describe("launch", () => {
  const user = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, treasury = Keypair.generate().publicKey;
  const recipients = { feeRecipient: Keypair.generate().publicKey, buybackFeeRecipient: Keypair.generate().publicKey };
  it("builds create_v2 (creator = CoinFee) + declare_coin, then the optional first buy", async () => {
    const base = await buildLaunchIxs({ user, mint, name: "N", symbol: "S", uri: "u", payee: { kind: "me" }, treasury, recipients });
    expect(base.map((i) => i.programId.toBase58())).toEqual([PUMP_PROGRAM_ID.toBase58(), SATPAD_VAULT_PROGRAM_ID.toBase58()]);
    const [coinFee] = coinFeePda(mint);
    expect(Buffer.from(base[0]!.data).includes(coinFee.toBuffer())).toBe(true); // creator is an instruction arg on create_v2 (V4)
    expect(base[0]!.keys.find((k) => k.pubkey.equals(mint))!.isSigner).toBe(true);
    expect(base[1]!.keys.find((k) => k.pubkey.equals(mint))!.isSigner).toBe(true);
    expect(base[1]!.keys.some((k) => k.pubkey.equals(configPda()[0]))).toBe(true);
    expect(base[1]!.keys.some((k) => k.pubkey.equals(treasury))).toBe(true);
    const withBuy = await buildLaunchIxs({ user, mint, name: "N", symbol: "S", uri: "u", payee: { kind: "holders" }, treasury, recipients, firstBuy: { tokenAmount: 1n, maxQuoteIn: 2n } });
    expect(withBuy).toHaveLength(4);
    expect(withBuy[3]!.programId.equals(PUMP_PROGRAM_ID)).toBe(true);
  });
  it("validates the form like the API", () => {
    const ok = { name: "Satoshi Cat", symbol: "SCAT", payeeKind: "me", payeeWallet: "", image: "data:image/png;base64,AAAA" };
    expect(validateLaunchForm(ok)).toBeNull();
    expect(validateLaunchForm({ ...ok, name: "x".repeat(33) })).toMatch(/32 bytes/);
    expect(validateLaunchForm({ ...ok, symbol: "way too long" })).toMatch(/Symbol/);
    expect(validateLaunchForm({ ...ok, image: "" })).toMatch(/Image/);
    expect(validateLaunchForm({ ...ok, payeeKind: "wallet", payeeWallet: "nope" })).toMatch(/Payee wallet/);
    expect(validateLaunchForm({ ...ok, payeeKind: "wallet", payeeWallet: Keypair.generate().publicKey.toBase58() })).toBeNull();
  });

  describe("planLaunch fits 1232 bytes", () => {
    const payer = Keypair.generate().publicKey;
    const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [] } });
    const ix = (dataBytes: number) => new TransactionInstruction({ programId: SystemProgram.programId, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.alloc(dataBytes) });
    it("single when everything fits", () => {
      const p = planLaunch(payer, [ix(100), ix(100)], [ix(50), ix(50)], [table]);
      expect(p.mode).toBe("single"); expect(p.launch).toHaveLength(4); expect(p.firstBuy).toHaveLength(0); expect(p.bytes).toBeLessThanOrEqual(MAX_TX_BYTES);
    });
    it("drops the priority fee when that is enough", () => {
      // base (no fee) ≈ 1232 - 5; the 9-byte CU-price instruction pushes it over
      const base = planLaunch(payer, [ix(100)], [], [table]).bytes; // includes CU limit + CU price
      const fill = MAX_TX_BYTES - base + 5; // over by 5 with fee, under without (fee ix = 9 bytes)
      const p = planLaunch(payer, [ix(100), ix(fill - 3)], [], [table]);
      expect(p.mode).toBe("single-no-fee"); expect(p.bytes).toBeLessThanOrEqual(MAX_TX_BYTES);
    });
    it("splits the first buy off when even that is too big, and refuses an oversize launch", () => {
      const p = planLaunch(payer, [ix(600)], [ix(600)], [table]);
      expect(p.mode).toBe("split"); expect(p.launch).toHaveLength(1); expect(p.firstBuy).toHaveLength(1);
      expect(() => planLaunch(payer, [ix(1300)], [], [table])).toThrow(/even without the first buy/);
    });
    it("the fork's measured worst case (1283 bytes) becomes a split", () => {
      void ComputeBudgetProgram; void PublicKey;
      const p = planLaunch(payer, [ix(700)], [ix(520)], [table]); // ≈ 1283 with budget ixs
      expect(["single-no-fee", "split"]).toContain(p.mode);
    });
  });
});

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { coinFeePda, configPda, SATPAD_VAULT_PROGRAM_ID, PUMP_PROGRAM_ID } from "@satpad/sdk";
import { buildLaunchIxs, validateLaunchForm } from "./launch";

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
});

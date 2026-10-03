import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { creatorVaultPda } from "@pump-fun/pump-sdk";
import {
  SATPAD_VAULT_PROGRAM_ID,
  coinFeeAta,
  coinFeePda,
  coinPda,
  configPda,
  lpPotPda,
  payeePotPda,
  rewardsPotPda,
  rewardsRunPda,
} from "../src/pda";

const mint = Keypair.generate().publicKey;
const otherMint = Keypair.generate().publicKey;

describe("satpad_vault PDAs", () => {
  it("derives every account off-curve under the program id", () => {
    const all = [configPda(), coinFeePda(mint), coinPda(mint), payeePotPda(mint), rewardsPotPda(mint), lpPotPda(), rewardsRunPda(mint, 0n)];
    for (const [addr, bump] of all) {
      expect(PublicKey.isOnCurve(addr.toBytes())).toBe(false);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    }
    // seeds are distinct: no two accounts for the same mint collide
    expect(new Set(all.map(([a]) => a.toBase58())).size).toBe(all.length);
  });

  it("is deterministic and keyed by mint", () => {
    expect(coinPda(mint)[0].equals(coinPda(mint)[0])).toBe(true);
    expect(coinPda(mint)[0].equals(coinPda(otherMint)[0])).toBe(false);
    expect(coinFeePda(mint)[0].equals(coinFeePda(otherMint)[0])).toBe(false);
  });

  it("matches a hand-rolled derivation of the spec seeds", () => {
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("coin_fee"), mint.toBuffer()], SATPAD_VAULT_PROGRAM_ID);
    expect(coinFeePda(mint)[0].equals(expected)).toBe(true);
    const [cfg] = PublicKey.findProgramAddressSync([Buffer.from("config")], SATPAD_VAULT_PROGRAM_ID);
    expect(configPda()[0].equals(cfg)).toBe(true);
  });

  it("encodes rewards_run index as u64 LE and rejects out-of-range", () => {
    const idx = Buffer.alloc(8);
    idx.writeBigUInt64LE(7n);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("rewards_run"), mint.toBuffer(), idx], SATPAD_VAULT_PROGRAM_ID);
    expect(rewardsRunPda(mint, 7n)[0].equals(expected)).toBe(true);
    expect(rewardsRunPda(mint, 7n)[0].equals(rewardsRunPda(mint, 8n)[0])).toBe(false);
    expect(() => rewardsRunPda(mint, -1n)).toThrow(RangeError);
    expect(() => rewardsRunPda(mint, 1n << 64n)).toThrow(RangeError);
  });

  it("accepts an alternate program id", () => {
    const alt = Keypair.generate().publicKey;
    expect(configPda(alt)[0].equals(configPda()[0])).toBe(false);
  });

  it("coinFeeAta is the off-curve ATA pump.fun's collect pays into, and the pump creator_vault differs from it", () => {
    const ata = coinFeeAta(mint);
    expect(PublicKey.isOnCurve(ata.toBytes())).toBe(false);
    // pump's own creator_vault PDA for this creator is a different account (fees sit there until collected)
    expect(creatorVaultPda(coinFeePda(mint)[0]).equals(ata)).toBe(false);
  });
});

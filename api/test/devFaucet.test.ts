import { describe, expect, it } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import { buildFaucetSwap, faucetQuote } from "../src/devFaucet";

describe("dev faucet (D17)", () => {
  const authority = Keypair.generate(), user = Keypair.generate();
  const conn = { getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }) };
  it("quotes at the fixed rate and bounds the amount", async () => {
    expect(faucetQuote(1_000_000_000n)).toBe(100_000n);
    await expect(buildFaucetSwap(conn, authority, user.publicKey, 0n)).rejects.toThrow(/lamports/);
    await expect(buildFaucetSwap(conn, authority, user.publicKey, 1n)).rejects.toThrow(/too small/);
  });
  it("returns a transaction partially signed by the authority: transfer, idempotent ATA, mintTo", async () => {
    const r = await buildFaucetSwap(conn, authority, user.publicKey, 500_000_000n);
    expect(r.sats).toBe(50_000n);
    const tx = Transaction.from(Buffer.from(r.transaction, "base64"));
    expect(tx.instructions).toHaveLength(3);
    expect(tx.feePayer!.equals(user.publicKey)).toBe(true);
    expect(tx.signatures.find((s) => s.publicKey.equals(authority.publicKey))!.signature).not.toBeNull();
    expect(tx.signatures.find((s) => s.publicKey.equals(user.publicKey))!.signature).toBeNull();
  });
});

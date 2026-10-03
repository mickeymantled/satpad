import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { VAULT_IDL } from "@satpad/sdk";
import { describeInstruction, registerInstructionNames, sendWithWallet, type Rpc, type WalletLike } from "./tx";

const payer = Keypair.generate();
const wallet: WalletLike = { publicKey: payer.publicKey, signTransaction: async (tx) => { if (tx instanceof VersionedTransaction) tx.sign([payer]); else tx.partialSign(payer); return tx; } };
const ix = () => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 42 });

describe("describeInstruction", () => {
  it("names programs and summarises system/compute/vault instructions", () => {
    expect(describeInstruction(ix())).toMatchObject({ program: "System", summary: "transfer 42 lamports", accounts: 2 });
    expect(describeInstruction(ComputeBudgetProgram.setComputeUnitLimit({ units: 123 })).summary).toBe("limit 123 CU");
    expect(describeInstruction(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 7 })).summary).toBe("price 7 µ-lamports/CU");
    registerInstructionNames((VAULT_IDL as unknown as { instructions: { discriminator: number[]; name: string }[] }).instructions);
  });
});

describe("sendWithWallet", () => {
  function rpc(plan: ("ok" | "expire")[], simErr: unknown = null) {
    let i = 0; const sent: Uint8Array[] = [];
    const r: Rpc = {
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }),
      simulateTransaction: (async () => ({ context: { slot: 1 }, value: { err: simErr, logs: ["Program log: x"], unitsConsumed: 5000 } })) as never,
      sendRawTransaction: async (raw) => { sent.push(raw as Uint8Array); return `sig${++i}`; },
      confirmTransaction: (async () => { const o = plan[i - 1] ?? "ok"; if (o === "expire") throw new Error("block height exceeded"); return { context: { slot: 1 }, value: { err: null } }; }) as never,
    };
    return { r, sent };
  }
  it("previews once (instructions, CU, fee, size), then signs and confirms", async () => {
    const { r, sent } = rpc(["ok"]);
    const previews: number[] = []; const statuses: string[] = [];
    const res = await sendWithWallet(r, wallet, [ix()], { fetchFee: async () => 1000n, onPreview: (p) => { previews.push(p.instructions.length); expect(p.unitsConsumed).toBe(5000); expect(p.priorityFeeMicroLamports).toBe(1000n); expect(p.sizeBytes).toBeGreaterThan(100); return true; }, onStatus: (s) => statuses.push(s) });
    expect(res).toEqual({ signature: "sig1", attempts: 1 });
    expect(previews).toEqual([3]); // compute limit + price + transfer
    expect(statuses).toEqual(["simulating", "awaiting signature", "sending", "confirming", "confirmed"]);
    expect(Transaction.from(sent[0]!).signatures[0]!.publicKey.equals(payer.publicKey)).toBe(true);
  });
  it("cancelling the preview sends nothing; a simulation error never reaches the wallet", async () => {
    const { r, sent } = rpc(["ok"]);
    await expect(sendWithWallet(r, wallet, [ix()], { fetchFee: async () => 1n, onPreview: () => false })).rejects.toThrow(/Cancelled/);
    const bad = rpc(["ok"], { InstructionError: [0, "Custom"] });
    await expect(sendWithWallet(bad.r, wallet, [ix()], { fetchFee: async () => 1n })).rejects.toThrow(/Simulation failed/);
    expect(sent).toHaveLength(0); expect(bad.sent).toHaveLength(0);
  });
  it("retries on expiry with a bumped fee and no second preview", async () => {
    const { r, sent } = rpc(["expire", "ok"]);
    let previews = 0;
    const res = await sendWithWallet(r, wallet, [ix()], { fetchFee: async () => 1000n, onPreview: () => { previews++; return true; } });
    expect(res.attempts).toBe(2); expect(sent).toHaveLength(2); expect(previews).toBe(1);
    const price = (raw: Uint8Array) => Transaction.from(raw).instructions[1]!.data.readBigUInt64LE(1);
    expect([price(sent[0]!), price(sent[1]!)]).toEqual([1000n, 1500n]);
  });
  it("extra signers (a launch's mint keypair) sign after the wallet", async () => {
    const { r, sent } = rpc(["ok"]);
    const mint = Keypair.generate();
    const ixn = SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId });
    await sendWithWallet(r, wallet, [ixn], { fetchFee: async () => 1n, extraSigners: [mint] });
    const tx = Transaction.from(sent[0]!);
    expect(tx.signatures.map((s) => s.publicKey.toBase58()).sort()).toEqual([payer.publicKey.toBase58(), mint.publicKey.toBase58()].sort());
    expect(tx.verifySignatures()).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { FixedFeeProvider, bump } from "../src/fees";
import { MemoryLedger } from "../src/ledger";
import { Sender, type Rpc } from "../src/rpc";
import { createLogger } from "../src/log";

const payer = Keypair.generate();
const ix = () => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
const log = createLogger({}, "error", () => {});

/** Scriptable RPC: `plan` is a list of outcomes per send attempt. */
function mockRpc(plan: ("ok" | "expire" | "confirmErr")[], simErr: unknown = null) {
  const sent: Transaction[] = [];
  let i = 0;
  const rpc: Rpc = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 + i }),
    simulateTransaction: (async () => ({ context: { slot: 1 }, value: { err: simErr, logs: simErr ? ["Program log: boom"] : [] } })) as Rpc["simulateTransaction"],
    sendRawTransaction: async (raw) => { sent.push(Transaction.from(raw)); return `sig${++i}`; },
    confirmTransaction: (async () => {
      const outcome = plan[i - 1] ?? "ok";
      if (outcome === "expire") throw Object.assign(new Error("TransactionExpiredBlockheightExceededError: Signature sig has expired: block height exceeded."), { name: "TransactionExpiredBlockheightExceededError" });
      return { context: { slot: 500 + i }, value: { err: outcome === "confirmErr" ? { InstructionError: [0, "Custom"] } : null } };
    }) as Rpc["confirmTransaction"],
  };
  return { rpc, sent };
}
const priceOf = (tx: Transaction): bigint => {
  const d = tx.instructions[1]!.data; // setComputeUnitPrice: u8 tag(3) + u64 LE
  return d.readBigUInt64LE(1);
};

describe("Sender", () => {
  it("writes built → sent → confirmed and returns the signature", async () => {
    const { rpc, sent } = mockRpc(["ok"]);
    const store = new MemoryLedger();
    const s = new Sender(rpc, new FixedFeeProvider(1000n), store, { computeUnitLimit: 200_000, maxAttempts: 5, log });
    const r = await s.send({ type: "settle", mint: "M", actor: payer.publicKey.toBase58(), amounts: { fee: "10" } }, [ix()], [payer]);
    expect(r.signature).toBe("sig1");
    expect(r.attempts).toBe(1);
    expect(store.rows[0]).toMatchObject({ status: "confirmed", signature: "sig1", attempts: 1, slot: 501n, type: "settle", amounts: { fee: "10" } });
    expect(sent).toHaveLength(1);
    expect(priceOf(sent[0]!)).toBe(1000n);
  });

  it("retries on blockhash expiry with a bumped fee, up to maxAttempts, and records every attempt", async () => {
    const { rpc, sent } = mockRpc(["expire", "expire", "ok"]);
    const store = new MemoryLedger();
    const s = new Sender(rpc, new FixedFeeProvider(1000n), store, { computeUnitLimit: 200_000, maxAttempts: 5, log });
    const r = await s.send({ type: "collect_creator_fee", actor: "k", amounts: {} }, [ix()], [payer]);
    expect(r.attempts).toBe(3);
    expect(sent.map(priceOf)).toEqual([1000n, 1500n, 2250n]);
    expect(store.rows[0]).toMatchObject({ status: "confirmed", signature: "sig3", attempts: 3 });
  });

  it("gives up after maxAttempts (≤ 5) and marks the row failed", async () => {
    const { rpc, sent } = mockRpc(["expire", "expire", "expire", "expire", "expire", "expire"]);
    const store = new MemoryLedger();
    const s = new Sender(rpc, new FixedFeeProvider(1000n), store, { computeUnitLimit: 200_000, maxAttempts: 5, log });
    await expect(s.send({ type: "settle", actor: "k", amounts: {} }, [ix()], [payer])).rejects.toThrow(/expired/);
    expect(sent).toHaveLength(5);
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: 5 });
  });

  it("does not retry a simulation failure and never sends", async () => {
    const { rpc, sent } = mockRpc(["ok"], { InstructionError: [0, { Custom: 6007 }] });
    const store = new MemoryLedger();
    const s = new Sender(rpc, new FixedFeeProvider(1000n), store, { computeUnitLimit: 200_000, maxAttempts: 5, log });
    await expect(s.send({ type: "settle", actor: "k", amounts: {} }, [ix()], [payer])).rejects.toThrow(/simulation failed/);
    expect(sent).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(store.rows[0]!.error).toContain("6007");
  });

  it("a transaction confirmed with an error is failed, not retried", async () => {
    const { rpc, sent } = mockRpc(["confirmErr"]);
    const store = new MemoryLedger();
    const s = new Sender(rpc, new FixedFeeProvider(1000n), store, { computeUnitLimit: 200_000, maxAttempts: 5, log });
    await expect(s.send({ type: "pay_payee", actor: "k", amounts: {} }, [ix()], [payer])).rejects.toThrow(/confirmed with error/);
    expect(sent).toHaveLength(1);
    expect(store.rows[0]!.status).toBe("failed");
  });
});

describe("fee bump", () => {
  it("+50% per attempt, capped at 8x", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((a) => bump(1000n, a))).toEqual([1000n, 1500n, 2250n, 3375n, 5063n, 7594n, 7594n]);
    expect(bump(1000n, 20)).toBe(7594n);
    expect(bump(1000n, 6) <= 8000n).toBe(true);
  });
});

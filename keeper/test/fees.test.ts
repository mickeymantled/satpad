import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { LiveFeeProvider, type FeeRpc } from "../src/fees";

const payer = Keypair.generate();
const tx = () => { const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })); t.feePayer = payer.publicKey; t.recentBlockhash = Keypair.generate().publicKey.toBase58(); return t; };

function rpc(helius: unknown | Error, recent: { slot: number; prioritizationFee: number }[] | Error): FeeRpc & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    _rpcRequest: async (method, args) => {
      calls.push(method);
      expect(method).toBe("getPriorityFeeEstimate");
      const p = (args as [{ transaction: string; options: Record<string, unknown> }])[0];
      expect(typeof p.transaction).toBe("string");
      expect(p.options["transactionEncoding"]).toBe("Base58");
      if (helius instanceof Error) return { error: { code: -32601, message: helius.message } };
      return { result: helius };
    },
    getRecentPrioritizationFees: async () => { calls.push("getRecentPrioritizationFees"); if (recent instanceof Error) throw recent; return recent; },
  };
}

describe("LiveFeeProvider", () => {
  it("uses the Helius estimate (V15 shape), clamped and bumped per attempt", async () => {
    const r = rpc({ priorityFeeEstimate: 10082 }, []);
    const p = new LiveFeeProvider(r, { min: 1_000n, max: 1_000_000n });
    expect(await p.estimate(tx(), 1)).toBe(10_082n);
    expect(await p.estimate(tx(), 2)).toBe(15_123n);
    expect(r.calls).toEqual(["getPriorityFeeEstimate", "getPriorityFeeEstimate"]);
  });
  it("falls back to p75 of getRecentPrioritizationFees when the RPC lacks the Helius method (-32601)", async () => {
    const r = rpc(new Error("Method not found"), [0, 1000, 5000, 200, 800].map((f, i) => ({ slot: i, prioritizationFee: f })));
    const p = new LiveFeeProvider(r, { min: 100n, max: 1_000_000n });
    expect(await p.estimate(tx(), 1)).toBe(1_000n); // sorted [0,200,800,1000,5000], index floor(5*0.75)=3 → 1000
    expect(r.calls).toEqual(["getPriorityFeeEstimate", "getRecentPrioritizationFees"]);
  });
  it("falls back to min when both fail or the window is all zeros (local validator)", async () => {
    expect(await new LiveFeeProvider(rpc(new Error("x"), new Error("y")), { min: 777n, max: 10_000n }).estimate(tx(), 1)).toBe(777n);
    expect(await new LiveFeeProvider(rpc(new Error("x"), [{ slot: 1, prioritizationFee: 0 }]), { min: 777n, max: 10_000n }).estimate(tx(), 1)).toBe(777n);
  });
  it("never exceeds max even when the estimate or bump would", async () => {
    const p = new LiveFeeProvider(rpc({ priorityFeeEstimate: 50_000_000 }, []), { min: 1n, max: 20_000n });
    expect(await p.estimate(tx(), 1)).toBe(20_000n);
    expect(await p.estimate(tx(), 5)).toBe(20_000n);
  });
  it("treats a malformed Helius response as unavailable", async () => {
    const p = new LiveFeeProvider(rpc({ priorityFeeLevels: { medium: 5 } }, [{ slot: 1, prioritizationFee: 42 }]), { min: 1n, max: 1_000n });
    expect(await p.estimate(tx(), 1)).toBe(42n);
  });
});

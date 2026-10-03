import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TokenBucket } from "../src/ratelimit";
import { MemoryCursorStore, PollingSource, type PollRpc, type TxSink } from "../src/sources";
import type { NormalizedTx } from "../src/decode";

describe("PollingSource when the cursor signature is purged from node history", () => {
  it("falls back to slot-floor paging, skips already-seen slots, keeps dedupe", async () => {
    const addr = Keypair.generate().publicKey;
    const cursors = new MemoryCursorStore();
    await cursors.set(addr.toBase58(), "oldsig", 100n);
    const page = [{ signature: "s3", slot: 130, err: null }, { signature: "s2", slot: 120, err: null }, { signature: "s1", slot: 100, err: null }, { signature: "s0", slot: 90, err: null }];
    const calls: unknown[] = [];
    const rpc: PollRpc = {
      getSignaturesForAddress: (async (_a: PublicKey, opts: { until?: string }) => { calls.push(opts); if (opts.until) throw new Error("failed to get signatures for address: Transaction oldsig not found"); return page; }) as never,
      getTransaction: (async (sig: string) => ({ slot: Number(sig.slice(1)) * 10 + 100, blockTime: 1, meta: { err: null, logMessages: [], preTokenBalances: [], postTokenBalances: [] }, version: "legacy", transaction: { signatures: [sig], message: { staticAccountKeys: [], compiledInstructions: [] } } })) as never,
      getFirstAvailableBlock: async () => 0,
    };
    const handled: string[] = [];
    const sink: TxSink = { handle: async (tx: NormalizedTx) => { handled.push(tx.signature); return true; } };
    const logs: string[] = [];
    const src = new PollingSource(rpc, new TokenBucket(1000), cursors, sink, { log: (m) => logs.push(m) });
    const r = await src.pollAddress(addr);
    expect(calls).toHaveLength(2); // until attempt, then fallback
    expect(handled).toEqual(["s1", "s2", "s3"]); // s1 shares the cursor's slot but is a different signature → new; s0 is below the floor
    expect(r.handled).toBe(3);
    expect(logs).toContain("cursor signature not in node history; paging by slot");
    expect((await cursors.get(addr.toBase58()))?.lastSignature).toBe("s3");
  });
});

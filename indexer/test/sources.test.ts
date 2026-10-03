import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TokenBucket } from "../src/ratelimit";
import { MemoryCursorStore, PollingSource, WebhookQueue, type PollRpc, type TxSink } from "../src/sources";
import { fromFixture, type NormalizedTx } from "../src/decode";

const fixtureJson = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${n}.json`), "utf8"));
/** Rebuild a web3-like VersionedTransactionResponse from a legacy fixture for `getTransaction` mocks. */
function rpcTx(n: string) {
  const j = fixtureJson(n);
  const keys = j.transaction.message.accountKeys.map((k: string) => new PublicKey(k));
  return { slot: j.slot, blockTime: j.blockTime, meta: j.meta, version: "legacy", transaction: { signatures: [j.signature], message: { staticAccountKeys: keys, compiledInstructions: j.transaction.message.instructions.map((ix: { programIdIndex: number; accounts: number[]; data: string }) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: new Uint8Array() })) } } };
}
class RecordingSink implements TxSink {
  seen = new Set<string>(); handled: NormalizedTx[] = [];
  async handle(tx: NormalizedTx) { if (this.seen.has(tx.signature)) return false; this.seen.add(tx.signature); this.handled.push(tx); return true; }
}

describe("TokenBucket", () => {
  it("allows burst then paces at perSecond, and counts requests", async () => {
    let now = 0; const sleeps: number[] = [];
    const b = new TokenBucket(2, 2, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    await b.take(); await b.take(); // burst
    expect(sleeps).toEqual([]);
    await b.take(); // must wait ~500 ms for one token at 2/s
    expect(sleeps[0]).toBe(500);
    expect(b.stats().total).toBe(3);
    expect(b.stats().lastMinute).toBe(3);
    now += 61_000;
    expect(b.stats().lastMinute).toBe(0);
  });
});

describe("PollingSource", () => {
  const addr = Keypair.generate().publicKey;
  const buy = fixtureJson("buy_v2"), sell = fixtureJson("sell_v2");
  const sigs: { signature: string; slot: number; err: unknown }[] = [{ signature: sell.signature, slot: sell.slot, err: null }, { signature: buy.signature, slot: buy.slot, err: null }]; // newest first as RPC returns
  function rpc(pages: typeof sigs[]) {
    const calls: { method: string; args: unknown }[] = [];
    let i = 0;
    const r: PollRpc = {
      getSignaturesForAddress: (async (_a: PublicKey, opts: unknown) => { calls.push({ method: "sigs", args: opts }); return pages[i++] ?? []; }) as never,
      getTransaction: (async (sig: string) => { calls.push({ method: "tx", args: sig }); return sig === buy.signature ? rpcTx("buy_v2") : rpcTx("sell_v2"); }) as never,
      getFirstAvailableBlock: async () => 0,
    };
    return { r, calls };
  }
  it("processes oldest → newest, stores the cursor, and uses `until` on the next poll", async () => {
    const { r, calls } = rpc([sigs, []]);
    const sink = new RecordingSink(); const cursors = new MemoryCursorStore();
    const src = new PollingSource(r, new TokenBucket(1000), cursors, sink);
    const first = await src.pollAddress(addr);
    expect(first).toMatchObject({ fetched: 2, handled: 2, newest: sell.signature });
    expect(sink.handled.map((t) => t.signature)).toEqual([buy.signature, sell.signature]);
    expect((await cursors.get(addr.toBase58()))?.lastSignature).toBe(sell.signature);
    await src.pollAddress(addr);
    const second = calls.filter((c) => c.method === "sigs")[1]!.args as { until?: string };
    expect(second.until).toBe(sell.signature);
  });
  it("dedupes through the sink and skips errored signatures", async () => {
    const { r } = rpc([[{ ...sigs[0]!, err: { x: 1 } }, sigs[1]!], [sigs[1]!]]);
    const sink = new RecordingSink();
    const src = new PollingSource(r, new TokenBucket(1000), new MemoryCursorStore(), sink);
    expect((await src.pollAddress(addr)).handled).toBe(1);
    expect((await src.pollAddress(addr)).handled).toBe(0); // same buy again → deduped
    expect(sink.handled).toHaveLength(1);
  });
  it("pollAll isolates a failing address", async () => {
    const bad: PollRpc = { getSignaturesForAddress: (async () => { throw new Error("rpc down"); }) as never, getTransaction: (async () => null) as never, getFirstAvailableBlock: async () => 0 };
    const logs: string[] = [];
    const src = new PollingSource(bad, new TokenBucket(1000), new MemoryCursorStore(), new RecordingSink(), { log: (m) => logs.push(m) });
    expect(await src.pollAll([addr, Keypair.generate().publicKey])).toEqual({ fetched: 0, handled: 0 });
    expect(logs.filter((l) => l === "poll failed")).toHaveLength(2);
  });
});

describe("WebhookQueue (V8)", () => {
  const raw = (n: string) => { const t = fromFixture(fixtureJson(n)); return { slot: Number(t.slot), blockTime: t.blockTime, transaction: { signatures: [t.signature], message: { accountKeys: t.accountKeys, instructions: [] } }, meta: { err: null, logMessages: t.logMessages, preTokenBalances: [], postTokenBalances: [] } }; };
  it("rejects a bad auth header (403), bad JSON (400), non-array (400)", () => {
    const q = new WebhookQueue(new RecordingSink(), { authHeader: "secret" });
    expect(q.accept("wrong", "[]")).toBe(403);
    expect(q.accept("secret", "{")).toBe(400);
    expect(q.accept("secret", "{}")).toBe(400);
    expect(q.rejected).toBe(1); expect(q.invalid).toBe(2);
  });
  it("acks 200 synchronously, processes async, dedupes duplicates, ignores malformed elements", async () => {
    const sink = new RecordingSink();
    const q = new WebhookQueue(sink, { authHeader: "secret" });
    const body = JSON.stringify([raw("buy_v2"), raw("buy_v2"), { nope: true }, raw("settle")]);
    expect(q.accept("secret", body)).toBe(200);
    await q.drain();
    expect(q.received).toBe(3); expect(q.invalid).toBe(1); expect(q.handled).toBe(2);
    expect(sink.handled.map((t) => t.signature).sort()).toEqual([fixtureJson("buy_v2").signature, fixtureJson("settle").signature].sort());
  });
});

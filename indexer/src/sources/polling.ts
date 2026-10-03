// Polling source: for each watched address, fetch signatures newer than the stored cursor (`until`), then the
// transactions, oldest first, through the rate limiter. Serves as the only source on the fork and as the
// reconcile/backfill path next to webhooks in production (V8: webhook events can be lost). Idempotent via the sink.
import { PublicKey, type Connection } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { indexerCursor, type Db } from "@satpad/db";
import { fromRpc, type NormalizedTx } from "../decode";
import type { TokenBucket } from "../ratelimit";
import type { TxSink } from "./types";

export type PollRpc = Pick<Connection, "getSignaturesForAddress" | "getTransaction" | "getFirstAvailableBlock">;

export interface CursorStore {
  get(address: string): Promise<{ lastSignature: string | null; lastSlot: bigint } | null>;
  set(address: string, lastSignature: string, lastSlot: bigint): Promise<void>;
}

export class PgCursorStore implements CursorStore {
  constructor(private readonly db: Db) {}
  async get(address: string) {
    const [r] = await this.db.select().from(indexerCursor).where(eq(indexerCursor.address, address));
    return r ? { lastSignature: r.lastSignature, lastSlot: r.lastSlot } : null;
  }
  async set(address: string, lastSignature: string, lastSlot: bigint) {
    await this.db.insert(indexerCursor).values({ address, lastSignature, lastSlot, updatedAt: new Date() })
      .onConflictDoUpdate({ target: indexerCursor.address, set: { lastSignature, lastSlot, updatedAt: new Date() } });
  }
}

export class MemoryCursorStore implements CursorStore {
  map = new Map<string, { lastSignature: string | null; lastSlot: bigint }>();
  async get(a: string) { return this.map.get(a) ?? null; }
  async set(a: string, lastSignature: string, lastSlot: bigint) { this.map.set(a, { lastSignature, lastSlot }); }
}

export interface PollingOptions { pageLimit?: number; log?: (msg: string, f?: Record<string, unknown>) => void }

export class PollingSource {
  constructor(private readonly rpc: PollRpc, private readonly bucket: TokenBucket, private readonly cursors: CursorStore, private readonly sink: TxSink, private readonly opts: PollingOptions = {}) {}

  /** One pass over one address. Returns how many transactions were handed to the sink (new ones only). */
  async pollAddress(address: PublicKey): Promise<{ fetched: number; handled: number; newest: string | null }> {
    const key = address.toBase58();
    const cursor = await this.cursors.get(key);
    const limit = this.opts.pageLimit ?? 1000;
    // Page backwards from newest until the cursor; collect, then process oldest → newest.
    const sigs: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    // `until` is the cheap path; a node with short history (solana-test-validator keeps ~60 slots; a pruned RPC)
    // rejects an `until` it no longer has, so fall back to paging by slot floor and dedupe by signature/slot.
    let useUntil = Boolean(cursor?.lastSignature);
    for (;;) {
      await this.bucket.take();
      let page;
      try {
        page = await this.rpc.getSignaturesForAddress(address, { limit, ...(before && { before }), ...(useUntil && cursor?.lastSignature && { until: cursor.lastSignature }) }, "confirmed");
      } catch (e) {
        if (useUntil && /not found/i.test((e as Error).message)) { useUntil = false; this.opts.log?.("cursor signature not in node history; paging by slot", { address: key }); continue; }
        throw e;
      }
      const floor = cursor?.lastSlot ?? 0n;
      const fresh = useUntil ? page : page.filter((s) => BigInt(s.slot) > floor || (BigInt(s.slot) === floor && s.signature !== cursor?.lastSignature));
      sigs.push(...fresh.map((s) => ({ signature: s.signature, slot: s.slot, err: s.err })));
      const reachedCursor = !useUntil && page.some((s) => BigInt(s.slot) <= floor);
      if (page.length < limit || reachedCursor) break;
      before = page[page.length - 1]!.signature;
    }
    sigs.reverse();
    let handled = 0;
    for (const s of sigs) {
      if (s.err) continue;
      await this.bucket.take();
      const tx = await this.rpc.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) { this.opts.log?.("transaction vanished before fetch (history purged?)", { signature: s.signature }); continue; }
      const norm: NormalizedTx = fromRpc(s.signature, tx);
      if (await this.sink.handle(norm)) handled++;
      await this.cursors.set(key, s.signature, BigInt(s.slot));
    }
    const newest = sigs.length ? sigs[sigs.length - 1]!.signature : null;
    // No new sigs: keep the cursor as is. Cursor set per tx above so a crash resumes mid-page.
    return { fetched: sigs.length, handled, newest };
  }

  async pollAll(addresses: PublicKey[]): Promise<{ fetched: number; handled: number }> {
    let fetched = 0, handled = 0;
    for (const a of addresses) {
      try {
        const r = await this.pollAddress(a);
        fetched += r.fetched; handled += r.handled;
      } catch (e) {
        this.opts.log?.("poll failed", { address: a.toBase58(), error: (e as Error).message });
      }
    }
    return { fetched, handled };
  }
}

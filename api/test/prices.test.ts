import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { CachedPriceProvider, PYTH_BTC_USD_FEED_ID, PYTH_RECEIVER_PROGRAM, PythPriceProvider, decodePriceUpdateV2, pythToUsdCents } from "../src/prices";

/** Builds a PriceUpdateV2 account per the V7 layout (Full verification). */
function account(price: bigint, expo: number, publishTime: number, feedId = PYTH_BTC_USD_FEED_ID): Buffer {
  const b = Buffer.alloc(134);
  b.writeUInt8(1, 40); // Full
  Buffer.from(feedId, "hex").copy(b, 41);
  b.writeBigInt64LE(price, 73); b.writeBigUInt64LE(1436235295n, 81); b.writeInt32LE(expo, 89); b.writeBigInt64LE(BigInt(publishTime), 93);
  return b;
}
const conn = (data: Buffer, owner = PYTH_RECEIVER_PROGRAM) => ({ getAccountInfo: async () => ({ data, owner, executable: false, lamports: 1, rentEpoch: 0 }) });

describe("Pyth BTC/USD (V7)", () => {
  it("decodes the live layout values the research recorded", () => {
    const p = decodePriceUpdateV2(account(8461892819165n, -8, 1_790_000_000));
    expect(p).toMatchObject({ price: 8461892819165n, expo: -8, publishTime: 1_790_000_000, feedId: PYTH_BTC_USD_FEED_ID });
    expect(pythToUsdCents(p)).toBe(8_461_892n); // $84,618.92
  });
  it("accepts a fresh price, rejects stale, wrong feed, wrong owner, non-positive", async () => {
    const now = 1_790_000_100;
    const fresh = new PythPriceProvider(conn(account(8_000_000_000_000n, -8, now - 57)), 300, undefined, () => now);
    expect((await fresh.btcUsd()).usdCents).toBe(8_000_000n);
    await expect(new PythPriceProvider(conn(account(8_000_000_000_000n, -8, now - 301)), 300, undefined, () => now).btcUsd()).rejects.toThrow(/stale/);
    await expect(new PythPriceProvider(conn(account(1n, -8, now, "00".repeat(32))), 300, undefined, () => now).btcUsd()).rejects.toThrow(/feed id/);
    await expect(new PythPriceProvider(conn(account(1n, -8, now), PublicKey.default), 300, undefined, () => now).btcUsd()).rejects.toThrow(/owner/);
    await expect(new PythPriceProvider(conn(account(0n, -8, now)), 300, undefined, () => now).btcUsd()).rejects.toThrow(/positive/);
  });
  it("cache serves repeated reads from one upstream call", async () => {
    let calls = 0;
    const c = new CachedPriceProvider({ btcUsd: async () => { calls++; return { usdCents: 1n, publishTime: 0, source: "x" }; } }, 60_000);
    await c.btcUsd(); await c.btcUsd();
    expect(calls).toBe(1);
  });
});

// BTC/USD for the "USD estimate" fields (SPEC: Pyth BTC/USD). Prices are integer cents; USD strings are derived with
// bigint math at read time and never stored. Production reads Pyth's on-chain feed account (V7: Hermes needs an API
// key since 2026-08-26; the sponsored account is free, one RPC read); the fixed provider serves the fork and tests.
export interface BtcPrice { usdCents: bigint; publishTime: number; source: string }
export interface PriceProvider { btcUsd(): Promise<BtcPrice> }

export class FixedPriceProvider implements PriceProvider {
  constructor(private readonly usdCents: bigint) {}
  async btcUsd(): Promise<BtcPrice> { return { usdCents: this.usdCents, publishTime: Math.floor(Date.now() / 1000), source: "fixed" }; }
}

/** Caches the upstream price for `ttlMs` so a burst of requests costs one upstream call. */
export class CachedPriceProvider implements PriceProvider {
  private cached: { at: number; value: BtcPrice } | null = null;
  constructor(private readonly inner: PriceProvider, private readonly ttlMs = 10_000) {}
  async btcUsd(): Promise<BtcPrice> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    const value = await this.inner.btcUsd();
    this.cached = { at: Date.now(), value };
    return value;
  }
}

/** sats → "123.45" USD string (floor to cents) at `usdCents` per BTC. */
export function satsToUsd(sats: bigint, usdCents: bigint): string {
  const cents = (sats * usdCents) / 100_000_000n;
  const whole = cents / 100n, frac = cents % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

import { Connection, PublicKey } from "@solana/web3.js";

/** Pyth Pull BTC/USD, sponsored feed account, shard 0 (VERIFIED V7). Owner: receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. */
export const PYTH_BTC_USD_FEED_ID = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
export const PYTH_BTC_USD_ACCOUNT = new PublicKey("4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo");
export const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

export interface PythPrice { price: bigint; conf: bigint; expo: number; publishTime: number; feedId: string }

/**
 * Decodes a `PriceUpdateV2` account (V7 layout): 8 disc | 32 write_authority | verification_level (1 byte Full=1, or
 * 2 bytes when Partial=0) | 32 feed_id | i64 price | u64 conf | i32 expo | i64 publish_time | …
 */
export function decodePriceUpdateV2(data: Buffer): PythPrice {
  if (data.length < 134) throw new Error(`price account too short: ${data.length}`);
  let o = 40;
  const level = data.readUInt8(o); o += level === 1 ? 1 : 2;
  const feedId = data.subarray(o, o + 32).toString("hex"); o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const conf = data.readBigUInt64LE(o); o += 8;
  const expo = data.readInt32LE(o); o += 4;
  const publishTime = Number(data.readBigInt64LE(o));
  return { price, conf, expo, publishTime, feedId };
}

/** price × 10^expo → integer cents, floored. */
export function pythToUsdCents(p: PythPrice): bigint {
  const e = p.expo + 2; // cents
  return e >= 0 ? p.price * 10n ** BigInt(e) : p.price / 10n ** BigInt(-e);
}

export class PythPriceProvider implements PriceProvider {
  constructor(private readonly conn: Pick<Connection, "getAccountInfo">, private readonly maxAgeSecs = 300, private readonly account = PYTH_BTC_USD_ACCOUNT, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}
  async btcUsd(): Promise<BtcPrice> {
    const info = await this.conn.getAccountInfo(this.account, "confirmed");
    if (!info) throw new Error("Pyth BTC/USD feed account not found");
    if (!info.owner.equals(PYTH_RECEIVER_PROGRAM)) throw new Error("Pyth feed account has an unexpected owner");
    const p = decodePriceUpdateV2(info.data);
    if (p.feedId !== PYTH_BTC_USD_FEED_ID) throw new Error(`unexpected feed id ${p.feedId}`);
    const age = this.now() - p.publishTime;
    if (age > this.maxAgeSecs) throw new Error(`Pyth price is stale (${age}s)`);
    if (p.price <= 0n) throw new Error("Pyth price not positive");
    return { usdCents: pythToUsdCents(p), publishTime: p.publishTime, source: "pyth" };
  }
}

// Priority-fee providers shared by the keeper, the API (`GET /fees/priority`) and so the web app (SPEC: Helius
// getPriorityFeeEstimate; retry with bumped fee). Shapes from VERIFIED V15. Micro-lamports per compute unit, bigint.
import type { Connection, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

export interface PriorityFeeProvider {
  /** Fee for `attempt` (1-based). Providers bump on retries so blockhash-expired sends land. */
  estimate(tx: Transaction, attempt: number): Promise<bigint>;
}

/** +50% per retry, capped at 8× the base so a runaway retry loop cannot overpay. */
export function bump(base: bigint, attempt: number): bigint {
  const a = Math.max(1, Math.min(attempt, 6));
  const scaled = (base * BigInt(Math.round(1.5 ** (a - 1) * 1000))) / 1000n;
  return scaled > base * 8n ? base * 8n : scaled;
}

export class FixedFeeProvider implements PriorityFeeProvider {
  constructor(private readonly base: bigint) {}
  async estimate(_tx: Transaction, attempt: number): Promise<bigint> {
    return bump(this.base, attempt);
  }
}

/** The two RPC calls the live provider needs; mockable. `_rpcRequest` is web3.js's raw JSON-RPC hook. */
export interface FeeRpc {
  _rpcRequest(method: string, args: unknown[]): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  getRecentPrioritizationFees(config?: { lockedWritableAccounts: Connection["rpcEndpoint"] extends string ? import("@solana/web3.js").PublicKey[] : never }): Promise<{ slot: number; prioritizationFee: number }[]>;
}

export type HeliusPriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax";

export interface LiveFeeOptions {
  priorityLevel?: HeliusPriorityLevel;
  /** Floor so a quiet network never produces a 0 fee that stalls under load. */
  min: bigint;
  /** Ceiling: the keeper refuses to pay more than this per CU no matter what the estimate says. */
  max: bigint;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * Helius `getPriorityFeeEstimate` on the signed transaction; on any error (non-Helius RPC → -32601, rate limit, server
 * error) falls back to standard `getRecentPrioritizationFees` (p75 of the recent window over the tx's writable
 * accounts); if that fails too, `min`. Clamped to [min, max], then bumped per attempt.
 */
export class LiveFeeProvider implements PriorityFeeProvider {
  constructor(private readonly rpc: FeeRpc, private readonly opts: LiveFeeOptions) {}

  async estimate(tx: Transaction, attempt: number): Promise<bigint> {
    const base = clamp(await this.baseEstimate(tx), this.opts.min, this.opts.max);
    return clamp(bump(base, attempt), this.opts.min, this.opts.max);
  }

  private async baseEstimate(tx: Transaction): Promise<bigint> {
    try {
      const serialized = bs58.encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      const res = await this.rpc._rpcRequest("getPriorityFeeEstimate", [{ transaction: serialized, options: { transactionEncoding: "Base58", priorityLevel: this.opts.priorityLevel ?? "Medium", recommended: true } }]);
      if (res.error) throw new Error(`${res.error.code} ${res.error.message}`);
      const est = (res.result as { priorityFeeEstimate?: number } | undefined)?.priorityFeeEstimate;
      if (typeof est !== "number" || !Number.isFinite(est) || est < 0) throw new Error("no priorityFeeEstimate in response");
      return BigInt(Math.ceil(est));
    } catch (e) {
      this.opts.log?.("helius fee estimate unavailable, falling back", { error: (e as Error).message });
    }
    try {
      const writable = tx.compileMessage().accountKeys.filter((_k, i) => tx.compileMessage().isAccountWritable(i)).slice(0, 128);
      const recent = await this.rpc.getRecentPrioritizationFees({ lockedWritableAccounts: writable } as never);
      const fees = recent.map((r) => BigInt(r.prioritizationFee)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (fees.length === 0) return this.opts.min;
      return fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))]!;
    } catch (e) {
      this.opts.log?.("getRecentPrioritizationFees unavailable, using min", { error: (e as Error).message });
      return this.opts.min;
    }
  }
}

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);

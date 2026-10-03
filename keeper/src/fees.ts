// Priority-fee providers. The keeper never hardcodes a fee: "helius" asks the RPC (VERIFIED V15), "fixed" is for the
// local fork and tests. Fees are micro-lamports per compute unit, bigint.
import type { Connection, Transaction } from "@solana/web3.js";

export interface PriorityFeeProvider {
  /** Fee for `attempt` (1-based). Providers bump on retries so blockhash-expired sends land. */
  estimate(tx: Transaction, attempt: number): Promise<bigint>;
}

export class FixedFeeProvider implements PriorityFeeProvider {
  constructor(private readonly base: bigint) {}
  async estimate(_tx: Transaction, attempt: number): Promise<bigint> {
    return bump(this.base, attempt);
  }
}

/** +50% per retry, capped at 8× the base so a runaway retry loop cannot overpay. */
export function bump(base: bigint, attempt: number): bigint {
  const a = Math.max(1, Math.min(attempt, 6));
  const scaled = (base * BigInt(Math.round(1.5 ** (a - 1) * 1000))) / 1000n;
  return scaled > base * 8n ? base * 8n : scaled;
}

/** Placeholder until VERIFIED V15 records the Helius request/response shape; throws so misconfiguration is loud. */
export class HeliusFeeProvider implements PriorityFeeProvider {
  constructor(_conn: Connection, _fallback: bigint) {}
  async estimate(): Promise<bigint> {
    throw new Error("HeliusFeeProvider not implemented until VERIFIED V15 is recorded");
  }
}

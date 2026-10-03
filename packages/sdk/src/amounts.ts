// BTC amounts on Solana. Every amount is a bigint in base units (1 base unit = 1 sat at 8 decimals). Floats are
// never used for money; `toUi` returns a decimal *string* for display only.
import { BTC_QUOTE_DECIMALS, SATS_PER_BTC } from "./quoteMints";

/** Base units (sats) as bigint. Branded so a raw bigint can't be passed where a checked amount is expected. */
export type Sats = bigint & { readonly __brand: "Sats" };

export const BPS_DENOMINATOR = 10_000n;

/** Wrap a non-negative bigint as Sats. Throws on negatives or values above u64. */
export function sats(v: bigint): Sats {
  if (v < 0n) throw new RangeError(`amount must be non-negative, got ${v}`);
  if (v > 0xffff_ffff_ffff_ffffn) throw new RangeError(`amount exceeds u64: ${v}`);
  return v as Sats;
}

/** Parse the base-unit string the API returns (`"123"`). Rejects anything that is not a plain decimal integer. */
export function parseSats(s: string): Sats {
  if (!/^\d+$/.test(s)) throw new RangeError(`not a base-unit integer string: ${JSON.stringify(s)}`);
  return sats(BigInt(s));
}

/**
 * Parse a user-typed decimal BTC string ("0.001", "1", ".5", "0.00000001") into sats. Rejects more than 8
 * fractional digits rather than rounding, so the UI must ask the user instead of silently truncating.
 */
export function parseBtc(s: string, decimals = BTC_QUOTE_DECIMALS): Sats {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s.trim());
  const wholeDigits = m?.[1] ?? "";
  const frac = m?.[2] ?? "";
  if (!m || (wholeDigits === "" && frac === "")) throw new RangeError(`not a decimal amount: ${JSON.stringify(s)}`);
  const whole = wholeDigits === "" ? "0" : wholeDigits;
  if (frac.length > decimals) throw new RangeError(`more than ${decimals} decimal places: ${s}`);
  return sats(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0"));
}

/** Base units → decimal string with no trailing zeros ("0.001", "1", "0"). Display only. */
export function toUi(v: bigint, decimals = BTC_QUOTE_DECIMALS): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Base units → whole BTC and remainder sats, for "0.00123456 BTC (123,456 sats)" style display. */
export function splitBtc(v: Sats): { btc: bigint; sats: bigint } {
  return { btc: v / SATS_PER_BTC, sats: v % SATS_PER_BTC };
}

/** `amount * bps / 10000`, floor, via bigint (no u64 overflow concern in JS; the program uses u128 intermediates). */
export function applyBps(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError(`bps out of range: ${bps}`);
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/**
 * Split an amount by the vault's four shares. The last share takes the rounding remainder so the parts always
 * sum to the input exactly — the program must do the same (SPEC "Fee split": four shares sum to 10000 bps).
 */
export function splitFee(amount: bigint, split: FeeSplitBps): FeeSplit {
  assertValidSplit(split);
  const liquidity = applyBps(amount, split.liquidityBps);
  const buyback = applyBps(amount, split.buybackBps);
  const operator = applyBps(amount, split.operatorBps);
  const deployer = amount - liquidity - buyback - operator;
  return { liquidity, buyback, operator, deployer };
}

export interface FeeSplitBps {
  liquidityBps: number;
  buybackBps: number;
  operatorBps: number;
  deployerBps: number;
}

export interface FeeSplit {
  liquidity: bigint;
  buyback: bigint;
  operator: bigint;
  deployer: bigint;
}

/** Program-enforced bounds (SPEC "Bounds the program enforces"). Mirrored as constants in satpad_vault. */
export const MIN_LIQUIDITY_BPS = 2500;
export const MAX_OPERATOR_BPS = 2000;

/** SPEC default split. */
export const DEFAULT_SPLIT: FeeSplitBps = { liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4000 };

/** Throws if the split is outside the program's bounds; the same checks `set_split` performs on chain. */
export function assertValidSplit(s: FeeSplitBps): void {
  for (const [k, v] of Object.entries(s)) {
    if (!Number.isInteger(v) || v < 0 || v > 10_000) throw new RangeError(`${k} out of range: ${v}`);
  }
  if (s.liquidityBps + s.buybackBps + s.operatorBps + s.deployerBps !== 10_000) throw new RangeError("split must sum to 10000 bps");
  if (s.liquidityBps < MIN_LIQUIDITY_BPS) throw new RangeError(`liquidity below ${MIN_LIQUIDITY_BPS} bps`);
  if (s.operatorBps > MAX_OPERATOR_BPS) throw new RangeError(`operator above ${MAX_OPERATOR_BPS} bps`);
}

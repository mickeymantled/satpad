// Display formatting. Inputs are base-unit strings/bigints from the API; no floats touch money until the final string.
import { toUi } from "@satpad/sdk";
import type { Amount } from "./api";

export const SATS_PER_BTC = 100_000_000n;
const groups = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "0.00123456 BTC" — trims to at most `maxFrac` decimals without rounding away non-zero digits below it. */
export function btc(base: string | bigint, maxFrac = 8): string {
  const v = typeof base === "bigint" ? base : BigInt(base);
  const ui = toUi(v, 8);
  const [w, f = ""] = ui.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return `${groups(w!)}${frac ? "." + frac : ""} BTC`;
}
/** "123,456 sats" */
export const sats = (base: string | bigint): string => `${groups((typeof base === "bigint" ? base : BigInt(base)).toString())} sats`;
/** "$1,234.56" from an amount's usd field, or from base + price cents. */
export function usd(a: Amount | string, btcUsdCents?: string): string {
  let cents: bigint;
  if (typeof a === "string") { if (!btcUsdCents) return "—"; cents = (BigInt(a) * BigInt(btcUsdCents)) / SATS_PER_BTC; }
  else { if (a.usd === undefined) return "—"; const [w, f = "00"] = a.usd.split("."); cents = BigInt(w!) * 100n + BigInt(f.padEnd(2, "0").slice(0, 2)); }
  const neg = cents < 0n; const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}$${groups((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, "0")}`;
}
/** Three-line money: BTC / sats / USD. */
export const money = (a: Amount) => ({ btc: btc(a.base), sats: sats(a.base), usd: usd(a) });
/** Token amounts (6 decimals) with grouping: "1,000.5" */
export function tokens(base: string | bigint): string {
  const ui = toUi(typeof base === "bigint" ? base : BigInt(base), 6);
  const [w, f] = ui.split(".");
  return `${groups(w!)}${f ? "." + f : ""}`;
}
/** Compact USD for cards: $1.2K, $3.4M */
export function usdCompact(a: Amount): string {
  if (a.usd === undefined) return "—";
  const n = Number(a.usd); // display only
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
export const short = (pk: string, n = 4) => (pk.length > 2 * n + 1 ? `${pk.slice(0, n)}…${pk.slice(-n)}` : pk);
export function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const STAGE_LABEL: Record<"dust" | "mining" | "block", string> = { dust: "Dust", mining: "Mining", block: "Block" };

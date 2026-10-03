// Every amount leaves the API as base-unit string + `ui` decimal string (SPEC "API"); USD when a price is known.
import { BTC_QUOTE_DECIMALS, COIN_DECIMALS, toUi } from "@satpad/sdk";
import { satsToUsd } from "./prices";

export interface Amount { base: string; ui: string; usd?: string }
export const btc = (v: bigint | string, usdCents?: bigint): Amount => {
  const b = typeof v === "string" ? BigInt(v) : v;
  const out: Amount = { base: b.toString(), ui: toUi(b, BTC_QUOTE_DECIMALS) };
  if (usdCents !== undefined) out.usd = satsToUsd(b, usdCents);
  return out;
};
export const tokens = (v: bigint | string): Amount => { const b = typeof v === "string" ? BigInt(v) : v; return { base: b.toString(), ui: toUi(b, COIN_DECIMALS) }; };
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

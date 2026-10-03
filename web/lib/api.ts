// Typed client for @satpad/api. Shapes mirror api/src/app.ts responses; amounts stay strings (base units) and are
// only formatted at render time with lib/format.ts. Server components call it with absolute URLs; the browser too.
import { env } from "./env";

export interface Amount { base: string; ui: string; usd?: string }
export type Stage = "dust" | "mining" | "block";
export type CoinSort = "volume24h" | "newest" | "mcap" | "trending" | "pays_holders";
export interface CoinSummary {
  mint: string; name: string | null; symbol: string | null; stage: Stage; payeeMode: "wallet" | "holders"; payee: string; paysHolders: boolean;
  curveProgressBps: number; buys: number; sells: number; holderCount: number;
  mcap: Amount; volume24h: Amount; trades24h: number; volumeLifetime: Amount; btcPaidToHolders: Amount; createdAt: string | null; lastTradeAt: string | null;
}
export interface CoinDetail extends CoinSummary {
  uri: string | null; deployer: string; bondingCurve: string; pool: string | null; paused: boolean; treasuryOnly: boolean; graduatedAt: string | null; indexedSlot: string;
  fees: { settles: number; creatorFee: Amount; liquidity: Amount; deployer: Amount };
  accounts: { coinFee: string; coinFeeAta: string; payeePot: string; rewardsPot: string; lpPot: string; config: string };
}
export interface Trade { signature: string; side: "buy" | "sell"; btc: Amount; tokens: Amount; priceBtcScaled: string; trader: string; slot: string; time: string | null; venue: "curve" | "pool"; creatorFee: Amount | null }
export interface Holder { wallet: string; balance: Amount; updatedSlot: string }
export interface RewardsRun { runIndex: string; snapshotHash: string; snapshotUrl: string | null; pot: Amount; holdersPaid: number; skipped: number; transferSignatures: string[]; releaseSignature: string; slot: string; time: string | null }
export interface LedgerEntry { id: string; signature: string | null; type: string; mint: string | null; actor: string; amounts: Record<string, Amount>; status: string; error: string | null; attempts: number; slot: string | null; createdAt: string | null; confirmedAt: string | null }
export interface Stats { coinsLaunched: number; btcIntoLiquidity: Amount; btcToBuyback: Amount; creatorFees: Amount; satpadBurned: Amount; btcPaidToHolders: Amount; btcTradedToday: Amount; tradesToday: number; btcUsd: { cents: string; publishTime: number; source: string } }
export interface Page { limit: number; offset: number; total?: number }

export class ApiError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new ApiError(res.status, `${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
const qs = (o: Record<string, string | number | boolean | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export const api = {
  coins: (o: { sort?: CoinSort; stage?: Stage; paysHolders?: boolean; limit?: number; offset?: number } = {}, init?: RequestInit) =>
    get<Page & { total: number; btcUsd: string; coins: CoinSummary[] }>(`/coins${qs({ sort: o.sort, stage: o.stage, pays_holders: o.paysHolders, limit: o.limit, offset: o.offset })}`, init),
  coin: (mint: string, init?: RequestInit) => get<CoinDetail>(`/coins/${mint}`, init),
  trades: (mint: string, o: { limit?: number; offset?: number } = {}, init?: RequestInit) => get<Page & { trades: Trade[] }>(`/coins/${mint}/trades${qs(o)}`, init),
  holders: (mint: string, o: { limit?: number; offset?: number } = {}, init?: RequestInit) => get<Page & { holders: Holder[] }>(`/coins/${mint}/holders${qs(o)}`, init),
  rewards: (mint: string, o: { limit?: number; offset?: number } = {}, init?: RequestInit) => get<Page & { runs: RewardsRun[] }>(`/coins/${mint}/rewards${qs(o)}`, init),
  ledger: (o: { type?: string; limit?: number; offset?: number } = {}, init?: RequestInit) => get<Page & { entries: LedgerEntry[] }>(`/ledger${qs(o)}`, init),
  stats: (init?: RequestInit) => get<Stats>("/stats", init),
};

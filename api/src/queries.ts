// Read models over the indexer tables. Derived numbers (mcap, progress, 24h volume) are computed here, in SQL where
// they need aggregation, with bigint/numeric only.
import { and, desc, eq, gt, gte, sql, type SQL } from "drizzle-orm";
import { coins, fees, holders, ledger, lpRuns, rewardsRuns, trades, type Db } from "@satpad/db";
import { INITIAL_REAL_TOKEN_RESERVES } from "@satpad/sdk";

export type CoinSort = "volume24h" | "newest" | "mcap" | "trending" | "pays_holders";
export const COIN_SORTS: CoinSort[] = ["volume24h", "newest", "mcap", "trending", "pays_holders"];
export type Stage = "dust" | "mining" | "block";

/** Market cap in sats: price per token (vq/vt) × total supply. 0 before the first trade. */
/** Market cap in sats: pool price once graduated (M6), else the curve's virtual reserves. */
export const mcapSatsSql = sql<string>`coalesce(case when ${coins.poolQuoteReserves} is not null and ${coins.poolBaseReserves} > 0 then floor((${coins.poolQuoteReserves} * ${coins.tokenTotalSupply}) / ${coins.poolBaseReserves}) else floor((${coins.virtualQuoteReserves} * ${coins.tokenTotalSupply}) / nullif(${coins.virtualTokenReserves}, 0)) end, 0)::numeric(40,0)`;
/** 10000 − real_token_reserves / initial_real × 10000, clamped. */
export const progressBpsSql = sql<number>`least(10000, greatest(0, 10000 - floor(coalesce(${coins.realTokenReserves}, ${INITIAL_REAL_TOKEN_RESERVES.toString()}) * 10000 / ${INITIAL_REAL_TOKEN_RESERVES.toString()})))::int`;
const vol24 = (db: Db) => db.select({ mint: trades.mint, v: sql<string>`sum(${trades.btcAmount})`.as("v"), n: sql<number>`count(*)::int`.as("n") }).from(trades).where(gte(trades.blockTime, sql`now() - interval '24 hours'`)).groupBy(trades.mint).as("v24");
const vol1 = (db: Db) => db.select({ mint: trades.mint, n: sql<number>`count(*)::int`.as("n1") }).from(trades).where(gte(trades.blockTime, sql`now() - interval '1 hour'`)).groupBy(trades.mint).as("v1");

export async function listCoins(db: Db, opts: { sort: CoinSort; stage?: Stage; paysHolders?: boolean; limit: number; offset: number }) {
  const v24 = vol24(db), v1 = vol1(db);
  const conds: SQL[] = [];
  if (opts.stage) conds.push(eq(coins.stage, opts.stage));
  if (opts.paysHolders) conds.push(eq(coins.payeeMode, "holders"));
  const volume24 = sql<string>`coalesce(${v24.v}, 0)`, trades24 = sql<number>`coalesce(${v24.n}, 0)`, trades1 = sql<number>`coalesce(${v1.n}, 0)`;
  const order = {
    volume24h: [desc(volume24), desc(coins.createdAt)], newest: [desc(coins.createdAt)], mcap: [desc(mcapSatsSql), desc(coins.createdAt)],
    trending: [desc(trades1), desc(volume24), desc(coins.createdAt)], pays_holders: [desc(sql`${coins.payeeMode} = 'holders'`), desc(volume24), desc(coins.createdAt)],
  }[opts.sort];
  const rows = await db.select({ c: coins, volume24, trades24, mcapSats: mcapSatsSql, progressBps: progressBpsSql })
    .from(coins).leftJoin(v24, eq(v24.mint, coins.mint)).leftJoin(v1, eq(v1.mint, coins.mint))
    .where(conds.length ? and(...conds) : undefined).orderBy(...order).limit(opts.limit).offset(opts.offset);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(coins).where(conds.length ? and(...conds) : undefined);
  return { rows, total: count?.total ?? 0 };
}

export async function getCoin(db: Db, mint: string) {
  const v24 = vol24(db);
  const [row] = await db.select({ c: coins, volume24: sql<string>`coalesce(${v24.v}, 0)`, trades24: sql<number>`coalesce(${v24.n}, 0)`, mcapSats: mcapSatsSql, progressBps: progressBpsSql })
    .from(coins).leftJoin(v24, eq(v24.mint, coins.mint)).where(eq(coins.mint, mint));
  if (!row) return null;
  const [feeTotals] = await db.select({ fee: sql<string>`coalesce(sum(${fees.creatorFeeBtc}), 0)`, liquidity: sql<string>`coalesce(sum(${fees.liquidity}), 0)`, deployer: sql<string>`coalesce(sum(${fees.deployer}), 0)`, settles: sql<number>`count(*)::int` }).from(fees).where(eq(fees.mint, mint));
  return { ...row, feeTotals: feeTotals! };
}

export const coinTrades = (db: Db, mint: string, limit: number, offset: number) => db.select().from(trades).where(eq(trades.mint, mint)).orderBy(desc(trades.slot), desc(trades.ixIndex)).limit(limit).offset(offset);
export const coinHolders = (db: Db, mint: string, limit: number, offset: number) => db.select().from(holders).where(and(eq(holders.mint, mint), gt(holders.balance, "0"))).orderBy(desc(holders.balance)).limit(limit).offset(offset);
export const coinRewards = (db: Db, mint: string, limit: number, offset: number) => db.select().from(rewardsRuns).where(eq(rewardsRuns.mint, mint)).orderBy(desc(rewardsRuns.runIndex)).limit(limit).offset(offset);
export const ledgerFeed = (db: Db, type: string | undefined, limit: number, offset: number) => db.select().from(ledger).where(type ? eq(ledger.type, type as (typeof ledger.$inferSelect)["type"]) : undefined).orderBy(desc(ledger.id)).limit(limit).offset(offset);

export async function stats(db: Db) {
  const [c] = await db.select({ coins: sql<number>`count(*)::int`, paidToHolders: sql<string>`coalesce(sum(${coins.btcPaidToHolders}), 0)` }).from(coins);
  const [f] = await db.select({ liquidity: sql<string>`coalesce(sum(${fees.liquidity}), 0)`, buyback: sql<string>`coalesce(sum(${fees.buyback}), 0)`, fees: sql<string>`coalesce(sum(${fees.creatorFeeBtc}), 0)` }).from(fees);
  const [t] = await db.select({ today: sql<string>`coalesce(sum(${trades.btcAmount}), 0)`, trades: sql<number>`count(*)::int` }).from(trades).where(gte(trades.blockTime, sql`now() - interval '24 hours'`));
  // $SATPAD burned = the keeper's confirmed buyback rows (each buys on the pool and burns in one transaction, M6).
  const [b] = await db.select({ burned: sql<string>`coalesce(sum((${ledger.amounts}->>'burned')::numeric), 0)` }).from(ledger).where(sql`${ledger.type} = 'buyback' and ${ledger.status} = 'confirmed'`);
  return { coins: c!.coins, btcIntoLiquidity: f!.liquidity, btcToBuyback: f!.buyback, creatorFees: f!.fees, btcPaidToHolders: c!.paidToHolders, btcTradedToday: t!.today, tradesToday: t!.trades, satpadBurned: b!.burned };
}

/** SPEC "Published addresses": every LP run with draw, buy, mint and burn amounts; LP burned must equal LP minted. */
export async function reserveRuns(db: Db, limit: number, offset: number) {
  const runs = await db.select().from(lpRuns).orderBy(desc(lpRuns.slot)).limit(limit).offset(offset);
  const [tot] = await db.select({ runs: sql<number>`count(*)::int`, drawn: sql<string>`coalesce(sum(${lpRuns.btcDrawn}), 0)`, minted: sql<string>`coalesce(sum(${lpRuns.lpMinted}), 0)`, burned: sql<string>`coalesce(sum(${lpRuns.lpBurned}), 0)` }).from(lpRuns);
  return { runs, totals: tot! };
}

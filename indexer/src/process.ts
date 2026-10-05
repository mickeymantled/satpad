// The processor: one normalized transaction → tables, inside one DB transaction, idempotent by signature
// (`processed_tx`). Only registered coins (rows in `coins`, created by the vault's `Declared` event or the keeper's
// registry upsert) get trades/holders/fees. Stage per SPEC: dust (< 10 buys) → mining (on the curve) → block
// (graduated). Emits pg_notify('satpad_live', …) for the WebSocket feed (task 7).
import { and, eq, gt, sql } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { coins, fees, holders, lpRuns, processedTx, rewardsRuns, trades, type Db } from "@satpad/db";
import type { TradeRecord } from "./decode";
import { BTC_QUOTE_MINT } from "@satpad/sdk";
const BTC_QUOTE_MINT_B58 = BTC_QUOTE_MINT.toBase58();
import { decodeTx, type Decoded, type NormalizedTx } from "./decode";
import type { TxSink } from "./sources";

export const DUST_MAX_BUYS = 10; // SPEC: Dust = fewer than 10 buys
/** price = btc_amount / token_amount in base units, scaled by 1e12 to stay integral. */
export const PRICE_SCALE = 1_000_000_000_000n;

export interface ProcessStats { processed: number; duplicates: number; trades: number; holders: number; settles: number; registered: number }

export class Processor implements TxSink {
  stats: ProcessStats = { processed: 0, duplicates: 0, trades: 0, holders: 0, settles: 0, registered: 0 };
  constructor(private readonly db: Db, private readonly log?: (msg: string, f?: Record<string, unknown>) => void) {}

  async handle(tx: NormalizedTx): Promise<boolean> {
    const decoded = decodeTx(tx);
    return this.db.transaction(async (t) => {
      const inserted = await t.insert(processedTx).values({ signature: tx.signature, slot: tx.slot }).onConflictDoNothing().returning({ signature: processedTx.signature });
      if (inserted.length === 0) { this.stats.duplicates++; return false; }
      await this.apply(t, tx, decoded);
      this.stats.processed++;
      return true;
    });
  }

  private async apply(t: Db, tx: NormalizedTx, d: Decoded): Promise<void> {
    // 1. registration (vault Declared) — before trades, since the launch tx carries create + declare + first buy
    for (const ev of d.vaultOther) {
      if (ev.name !== "Declared") continue;
      const data = ev.data as { mint: PublicKey; deployer: PublicKey; payee: PublicKey; payee_mode: Record<string, unknown>; treasury_only: boolean };
      const mint = data.mint.toBase58();
      const create = d.creates.find((c) => c.mint === mint);
      await t.insert(coins).values({
        mint, deployer: data.deployer.toBase58(), payee: data.payee.toBase58(), payeeMode: "Holders" in data.payee_mode ? "holders" : "wallet", treasuryOnly: data.treasury_only,
        bondingCurve: bondingCurvePda(data.mint).toBase58(), createdAt: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
        name: create?.name ?? null, symbol: create?.symbol ?? null, uri: create?.uri ?? null,
        tokenTotalSupply: create ? create.tokenTotalSupply.toString() : null, virtualTokenReserves: create ? create.virtualTokenReserves.toString() : null,
        realTokenReserves: create ? create.realTokenReserves.toString() : null, virtualQuoteReserves: create ? create.virtualQuoteReserves.toString() : null, indexedSlot: tx.slot,
      }).onConflictDoUpdate({ target: coins.mint, set: { name: sql`coalesce(excluded.name, ${coins.name})`, symbol: sql`coalesce(excluded.symbol, ${coins.symbol})`, uri: sql`coalesce(excluded.uri, ${coins.uri})` } });
      this.stats.registered++;
      await t.execute(sql`select pg_notify('satpad_live', ${JSON.stringify({ kind: "coin", mint, symbol: create?.symbol ?? null, slot: tx.slot.toString() })})`);
    }
    // create events for already-registered coins (name/symbol arrive with the launch tx)
    for (const c of d.creates) {
      await t.update(coins).set({ name: c.name, symbol: c.symbol, uri: c.uri, tokenTotalSupply: c.tokenTotalSupply.toString() }).where(and(eq(coins.mint, c.mint), sql`${coins.name} is null`));
    }

    // 2. trades on registered coins
    const registered = new Map<string, { bondingCurve: string; pool: string | null }>();
    const isRegistered = async (mint: string) => {
      if (registered.has(mint)) return true;
      const [row] = await t.select({ bondingCurve: coins.bondingCurve, pool: coins.pool }).from(coins).where(eq(coins.mint, mint));
      if (!row) return false;
      registered.set(mint, row);
      return true;
    };
    const insertTrade = async (tr: TradeRecord, poolReserves?: { base: bigint; quote: bigint }) => {
      const price = tr.tokenAmount > 0n ? (tr.btcAmount * PRICE_SCALE) / tr.tokenAmount : 0n;
      const ins = await t.insert(trades).values({
        signature: tr.signature, ixIndex: tr.ixIndex, mint: tr.mint, side: tr.side, btcAmount: tr.btcAmount.toString(), tokenAmount: tr.tokenAmount.toString(), priceBtcScaled: price.toString(),
        trader: tr.trader, slot: tr.slot, blockTime: tr.blockTime ? new Date(tr.blockTime * 1000) : null, venue: tr.venue, creatorFeeBtc: tr.creatorFeeBtc.toString(),
      }).onConflictDoNothing().returning({ signature: trades.signature });
      if (ins.length === 0) return;
      this.stats.trades++;
      await t.update(coins).set({
        buys: tr.side === "buy" ? sql`${coins.buys} + 1` : coins.buys,
        sells: tr.side === "sell" ? sql`${coins.sells} + 1` : coins.sells,
        volumeBtc: sql`${coins.volumeBtc} + ${tr.btcAmount.toString()}::numeric`,
        // curve columns move only with curve trades; after graduation they stay at the final curve state and the pool columns move
        // Transactions can arrive out of slot order across polled addresses (pool vs vault program): reserves only move
        // forward — an older transaction must not overwrite a newer state (counters are order-independent).
        ...(poolReserves
          ? { poolBaseReserves: sql`case when ${coins.indexedSlot} <= ${tr.slot} then ${poolReserves.base.toString()}::numeric else ${coins.poolBaseReserves} end`, poolQuoteReserves: sql`case when ${coins.indexedSlot} <= ${tr.slot} then ${poolReserves.quote.toString()}::numeric else ${coins.poolQuoteReserves} end` }
          : { virtualQuoteReserves: sql`case when ${coins.indexedSlot} <= ${tr.slot} then ${tr.virtualQuoteReserves.toString()}::numeric else ${coins.virtualQuoteReserves} end`, virtualTokenReserves: sql`case when ${coins.indexedSlot} <= ${tr.slot} then ${tr.virtualTokenReserves.toString()}::numeric else ${coins.virtualTokenReserves} end`, realTokenReserves: sql`case when ${coins.indexedSlot} <= ${tr.slot} then ${tr.realTokenReserves.toString()}::numeric else ${coins.realTokenReserves} end` }),
        lastTradeAt: tr.blockTime ? new Date(tr.blockTime * 1000) : new Date(), indexedSlot: sql`greatest(${coins.indexedSlot}, ${tr.slot})`,
        stage: sql`(case when ${coins.stage} = 'block' then 'block' when ${coins.buys} + ${tr.side === "buy" ? 1 : 0} >= ${DUST_MAX_BUYS} then 'mining' else 'dust' end)::stage`,
      }).where(eq(coins.mint, tr.mint));
      await t.execute(sql`select pg_notify('satpad_live', ${JSON.stringify({ kind: "trade", mint: tr.mint, side: tr.side, btc: tr.btcAmount.toString(), tokens: tr.tokenAmount.toString(), trader: tr.trader, signature: tr.signature, slot: tr.slot.toString(), venue: tr.venue })})`);
    };
    for (const tr of d.trades) {
      if (!(await isRegistered(tr.mint))) continue;
      await insertTrade(tr);
    }
    // 2b. PumpSwap trades on registered pools (M6): resolve pool → mint, store as venue "pool" with the pool reserves
    const mintByPool = new Map<string, string>();
    const resolvePool = async (pool: string) => {
      if (mintByPool.has(pool)) return mintByPool.get(pool)!;
      const [row] = await t.select({ mint: coins.mint, bondingCurve: coins.bondingCurve }).from(coins).where(eq(coins.pool, pool));
      if (!row) return null;
      mintByPool.set(pool, row.mint); registered.set(row.mint, { bondingCurve: row.bondingCurve, pool });
      return row.mint;
    };
    // PumpSwap events carry the reserves *before* the instruction; the exact post-transaction reserves are the pool's
    // token accounts (owner = pool) in postTokenBalances.
    const poolReservesAfter = (pool: string, mint: string) => {
      const post = (m: string) => tx.postTokenBalances.find((b) => b.owner === pool && b.mint === m)?.amount;
      const base = post(mint), quote = post(BTC_QUOTE_MINT_B58);
      return base !== undefined && quote !== undefined ? { base, quote } : null;
    };
    for (const pt of d.poolTrades) {
      const mint = await resolvePool(pt.pool);
      if (!mint) continue;
      const after = poolReservesAfter(pt.pool, mint) ?? { base: pt.poolBaseReserves, quote: pt.poolQuoteReserves };
      await insertTrade({ signature: pt.signature, ixIndex: 1000 + pt.ixIndex, mint, side: pt.side, btcAmount: pt.btcAmount, tokenAmount: pt.tokenAmount, trader: pt.trader, slot: pt.slot, blockTime: pt.blockTime, venue: "pool", creatorFeeBtc: pt.creatorFeeBtc, virtualQuoteReserves: 0n, virtualTokenReserves: 0n, realQuoteReserves: 0n, realTokenReserves: 0n, quoteMint: "" }, after);
    }
    for (const dep of d.deposits) {
      const mint = await resolvePool(dep.pool);
      if (!mint) continue;
      const after = poolReservesAfter(dep.pool, mint);
      if (after) await t.update(coins).set({ poolBaseReserves: sql`case when ${coins.indexedSlot} <= ${tx.slot} then ${after.base.toString()}::numeric else ${coins.poolBaseReserves} end`, poolQuoteReserves: sql`case when ${coins.indexedSlot} <= ${tx.slot} then ${after.quote.toString()}::numeric else ${coins.poolQuoteReserves} end`, indexedSlot: sql`greatest(${coins.indexedSlot}, ${tx.slot})` }).where(eq(coins.mint, mint));
    }

    // 3. holders for registered coin mints (not the quote mint); bonding curve / pool are not holders
    const holderMints = new Set([...new Set(d.holders.map((h) => h.mint))].filter((m) => registered.has(m)));
    for (const m of d.holders.map((h) => h.mint)) if (!holderMints.has(m) && (await isRegistered(m))) holderMints.add(m);
    for (const h of d.holders) {
      if (!holderMints.has(h.mint)) continue;
      const reg = registered.get(h.mint)!;
      if (h.wallet === reg.bondingCurve || (reg.pool && h.wallet === reg.pool)) continue;
      await t.insert(holders).values({ mint: h.mint, wallet: h.wallet, balance: h.balance.toString(), updatedSlot: h.slot })
        .onConflictDoUpdate({ target: [holders.mint, holders.wallet], set: { balance: sql`excluded.balance`, updatedSlot: sql`excluded.updated_slot` }, setWhere: sql`${holders.updatedSlot} <= excluded.updated_slot` });
      this.stats.holders++;
    }
    for (const m of holderMints) {
      const [c] = await t.select({ n: sql<number>`count(*)::int` }).from(holders).where(and(eq(holders.mint, m), gt(holders.balance, "0")));
      await t.update(coins).set({ holderCount: c?.n ?? 0 }).where(eq(coins.mint, m));
    }

    // 4. graduation
    for (const c of d.completes) {
      // migrate_v2 drains the curve (reserves read 0 on chain afterwards); price moves to the pool columns from here on
      await t.update(coins).set({ stage: "block", pool: c.pool, graduatedAt: new Date(Number(c.timestamp) * 1000), ...(c.pool && { virtualQuoteReserves: "0", virtualTokenReserves: "0", realTokenReserves: "0" }) }).where(eq(coins.mint, c.mint));
    }

    // 5. vault events
    for (const s of d.settles) {
      await t.insert(fees).values({ signature: s.signature, mint: s.mint, creatorFeeBtc: s.amount.toString(), liquidity: s.liquidity.toString(), buyback: s.buyback.toString(), operator: s.operator.toString(), deployer: s.deployer.toString(), slot: s.slot, settledAt: s.blockTime ? new Date(s.blockTime * 1000) : null }).onConflictDoNothing();
      this.stats.settles++;
    }
    for (const ev of d.vaultOther) {
      const data = ev.data as Record<string, unknown>;
      switch (ev.name) {
        case "PayeeRedirected": await t.update(coins).set({ payee: (data["new_payee"] as PublicKey).toBase58() }).where(eq(coins.mint, (data["mint"] as PublicKey).toBase58())); break;
        case "HolderRewardsSet": await t.update(coins).set({ payee: PublicKey.default.toBase58(), payeeMode: "holders" }).where(eq(coins.mint, (data["mint"] as PublicKey).toBase58())); break;
        case "Paused": { const mint = (data["mint"] as PublicKey).toBase58(); if (mint !== PublicKey.default.toBase58()) await t.update(coins).set({ paused: Boolean(data["paused"]) }).where(eq(coins.mint, mint)); break; }
        case "RewardsReleased": {
          const mint = (data["mint"] as PublicKey).toBase58();
          const amount = String(data["amount"]);
          await t.insert(rewardsRuns).values({ mint, runIndex: BigInt(String(data["run_index"])), snapshotHash: Buffer.from(data["snapshot_sha256"] as number[]).toString("hex"), potBtc: amount, releaseSignature: ev.signature, slot: ev.slot, releasedAt: ev.blockTime ? new Date(ev.blockTime * 1000) : null }).onConflictDoNothing();
          await t.update(coins).set({ btcPaidToHolders: sql`${coins.btcPaidToHolders} + ${amount}::numeric` }).where(eq(coins.mint, mint));
          break;
        }
        case "LpDrawn": {
          // One LP run = draw + swap + deposit + burn in one tx (SPEC Reserve): merge the AMM deposit event and the burn
          // (LP minted minus what the user's LP account kept) into the same row.
          const dep = d.deposits[0];
          const bought = d.poolTrades.filter((p) => p.side === "buy" && (!dep || p.pool === dep.pool)).reduce((a, p) => a + p.tokenAmount, 0n);
          let lpBurned = 0n;
          if (dep) {
            const idx = tx.accountKeys.indexOf(dep.userPoolTokenAccount);
            const pre = tx.preTokenBalances.find((b) => b.accountIndex === idx)?.amount ?? 0n, post = tx.postTokenBalances.find((b) => b.accountIndex === idx)?.amount ?? 0n;
            lpBurned = dep.lpTokenOut - (post - pre);
          }
          await t.insert(lpRuns).values({
            signature: ev.signature, btcDrawn: String(data["amount"]), satpadBought: bought.toString(), lpMinted: (dep?.lpTokenOut ?? 0n).toString(), lpBurned: lpBurned.toString(),
            poolReservesAfter: dep ? (() => { const post = (m: string) => tx.postTokenBalances.find((b) => b.owner === dep.pool && b.mint === m)?.amount; const q = post(BTC_QUOTE_MINT_B58), bases = tx.postTokenBalances.filter((b) => b.owner === dep.pool && b.mint !== BTC_QUOTE_MINT_B58); const base = bases[0]?.amount; return base !== undefined && q !== undefined ? { base: base.toString(), quote: q.toString() } : { base: dep.poolBaseReserves.toString(), quote: dep.poolQuoteReserves.toString() }; })() : null, slot: ev.slot, ranAt: ev.blockTime ? new Date(ev.blockTime * 1000) : null,
          }).onConflictDoNothing();
          break;
        }
        default: break;
      }
    }
    this.log?.("processed", { signature: tx.signature, trades: d.trades.length, settles: d.settles.length, holders: d.holders.length });
  }
}

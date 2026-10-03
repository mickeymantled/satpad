import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { DEFAULT_LOCAL_DATABASE_URL, coins, connect, fees, holders, trades, type Db } from "@satpad/db";
import { runMigrations } from "@satpad/db/src/migrate";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import { decodeTx, fromFixture, type NormalizedTx } from "../src/decode";
import { Processor } from "../src/process";

const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
const fixture = (n: string): NormalizedTx => fromFixture(JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${n}.json`), "utf8")));
const reachable = async () => { const c = new Client({ connectionString: BASE }); try { await c.connect(); await c.end(); return true; } catch { return false; } };

describe("Processor (Postgres)", async () => {
  if (!(await reachable())) { it.skip("Postgres not reachable", () => {}); return; }
  const name = `satpad_idx_${process.pid}`; const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  let db: Db, close: () => Promise<void>;
  beforeAll(async () => { const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`CREATE DATABASE ${name}`); await a.end(); await runMigrations(url); ({ db, close } = connect(url)); });
  afterAll(async () => { await close(); const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`DROP DATABASE ${name}`); await a.end(); });

  const buy = fixture("buy_v2"), sell = fixture("sell_v2"), settle = fixture("settle"), pay = fixture("pay_payee");
  const buyTrade = decodeTx(buy).trades[0]!;
  const mint = buyTrade.mint;

  it("ignores trades on unregistered coins, then indexes once registered; idempotent by signature", async () => {
    const p = new Processor(db);
    expect(await p.handle(buy)).toBe(true);
    expect(await db.select().from(trades)).toHaveLength(0); // not registered yet
    expect(await p.handle(buy)).toBe(false); // duplicate signature
    // register (as the keeper's upsert or a Declared event would)
    await db.insert(coins).values({ mint, deployer: "D", payee: "D", payeeMode: "wallet", bondingCurve: bondingCurvePda(new PublicKey(mint)).toBase58(), createdAt: new Date() });
    const p2 = new Processor(db);
    const buy2 = { ...buy, signature: buy.signature + "x" }; // same content, new signature → indexes
    expect(await p2.handle(buy2)).toBe(true);
    const rows = await db.select().from(trades);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mint, side: "buy", btcAmount: buyTrade.btcAmount.toString(), tokenAmount: buyTrade.tokenAmount.toString(), venue: "curve" });
    expect(BigInt(rows[0]!.priceBtcScaled)).toBe((buyTrade.btcAmount * 1_000_000_000_000n) / buyTrade.tokenAmount);
    const [c] = await db.select().from(coins).where(eq(coins.mint, mint));
    expect(c).toMatchObject({ buys: 1, sells: 0, stage: "dust", volumeBtc: buyTrade.btcAmount.toString() });
    expect(c!.virtualQuoteReserves).toBe(buyTrade.virtualQuoteReserves.toString());
    expect(c!.lastTradeAt).not.toBeNull();
  });

  it("holders come from post balances, exclude the bonding curve, and holder_count counts positive balances", async () => {
    const h = await db.select().from(holders).where(eq(holders.mint, mint));
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h.some((x) => x.wallet === bondingCurvePda(new PublicKey(mint)).toBase58())).toBe(false);
    const trader = h.find((x) => x.wallet === buyTrade.trader);
    expect(trader && BigInt(trader.balance) > 0n).toBe(true);
    const [c] = await db.select().from(coins).where(eq(coins.mint, mint));
    expect(c!.holderCount).toBe(h.filter((x) => BigInt(x.balance) > 0n).length);
  });

  it("sell updates counters; the stage flips to mining at 10 buys", async () => {
    const p = new Processor(db);
    if (decodeTx(sell).trades[0]!.mint === mint) {
      await p.handle(sell);
      expect((await db.select().from(coins).where(eq(coins.mint, mint)))[0]!.sells).toBe(1);
    }
    for (let i = 0; i < 9; i++) await p.handle({ ...buy, signature: `${buy.signature}-${i}` });
    const [c] = await db.select().from(coins).where(eq(coins.mint, mint));
    expect(c!.buys).toBe(10);
    expect(c!.stage).toBe("mining");
  });

  it("Settled → fees row; PayeePaid leaves fees alone; both idempotent", async () => {
    const settleMint = decodeTx(settle).settles[0]!.mint;
    await db.insert(coins).values({ mint: settleMint, deployer: "D", payee: "D", payeeMode: "wallet", bondingCurve: "BC", createdAt: new Date() }).onConflictDoNothing();
    const p = new Processor(db);
    expect(await p.handle(settle)).toBe(true);
    expect(await p.handle(pay)).toBe(true);
    expect(await p.handle(settle)).toBe(false);
    const f = await db.select().from(fees);
    expect(f).toHaveLength(1);
    const s = decodeTx(settle).settles[0]!;
    expect(f[0]).toMatchObject({ mint: settleMint, creatorFeeBtc: s.amount.toString(), liquidity: s.liquidity.toString(), deployer: s.deployer.toString() });
    expect(p.stats).toMatchObject({ processed: 2, duplicates: 1, settles: 1 });
  });
});

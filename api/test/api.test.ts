import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { DEFAULT_LOCAL_DATABASE_URL, coins, connect, fees, holders, ledger, lpRuns, trades, type Db } from "@satpad/db";
import { runMigrations } from "@satpad/db/src/migrate";
import { Keypair } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { FixedPriceProvider, satsToUsd } from "../src/prices";

const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
const reachable = async () => { const c = new Client({ connectionString: BASE }); try { await c.connect(); await c.end(); return true; } catch { return false; } };

describe("satsToUsd", () => {
  it("floors to cents with bigint math", () => {
    expect(satsToUsd(100_000_000n, 10_000_000n)).toBe("100000.00");
    expect(satsToUsd(1n, 10_000_000n)).toBe("0.00");
    expect(satsToUsd(12_345n, 10_000_000n)).toBe("12.34");
  });
});

describe("API (Postgres)", async () => {
  if (!(await reachable())) { it.skip("Postgres not reachable", () => {}); return; }
  const name = `satpad_api_${process.pid}`; const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  let db: Db, close: () => Promise<void>, app: FastifyInstance;
  const m1 = Keypair.generate().publicKey.toBase58(), m2 = Keypair.generate().publicKey.toBase58();
  beforeAll(async () => {
    const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`CREATE DATABASE ${name}`); await a.end();
    await runMigrations(url); ({ db, close } = connect(url));
    const base = { deployer: "D", payee: "P", bondingCurve: "BC", tokenTotalSupply: "1000000000000000", virtualTokenReserves: "1072999000000000", virtualQuoteReserves: "5082192", realTokenReserves: "793099000000000" };
    await db.insert(coins).values([
      { ...base, mint: m1, name: "Alpha", symbol: "ALPHA", payeeMode: "wallet", stage: "mining", buys: 12, sells: 3, volumeBtc: "500000", holderCount: 2, createdAt: new Date(Date.now() - 3600_000), realTokenReserves: "396549500000000", virtualQuoteReserves: "10164384" },
      { ...base, mint: m2, name: "Beta", symbol: "BETA", payeeMode: "holders", stage: "dust", buys: 2, sells: 0, volumeBtc: "100", holderCount: 1, createdAt: new Date(), btcPaidToHolders: "777" },
    ]);
    await db.insert(trades).values([
      { signature: "t1", ixIndex: 0, mint: m1, side: "buy", btcAmount: "300000", tokenAmount: "1000000000", priceBtcScaled: "300000000000000000", trader: "A", slot: 10n, blockTime: new Date(), venue: "curve" },
      { signature: "t2", ixIndex: 0, mint: m1, side: "sell", btcAmount: "200000", tokenAmount: "500000000", priceBtcScaled: "400000000000000000", trader: "B", slot: 11n, blockTime: new Date(Date.now() - 2 * 24 * 3600_000), venue: "curve" }, // older than 24h
      { signature: "t3", ixIndex: 0, mint: m2, side: "buy", btcAmount: "100", tokenAmount: "1000000", priceBtcScaled: "100000000000000", trader: "A", slot: 12n, blockTime: new Date(), venue: "curve" },
    ]);
    await db.insert(holders).values([{ mint: m1, wallet: "A", balance: "1000000000", updatedSlot: 10n }, { mint: m1, wallet: "B", balance: "0", updatedSlot: 11n }, { mint: m1, wallet: "C", balance: "5", updatedSlot: 9n }]);
    await db.insert(fees).values({ signature: "f1", mint: m1, creatorFeeBtc: "10000", liquidity: "2500", buyback: "2500", operator: "1000", deployer: "4000", slot: 10n });
    await db.insert(ledger).values([{ type: "settle", mint: m1, actor: "k", amounts: { fee: "10000" }, status: "confirmed", signature: "f1" }, { type: "draw_lp", actor: "lp", amounts: { amount: "1" }, status: "confirmed", signature: "d1" }]);
    app = await buildApp({ db, prices: new FixedPriceProvider(10_000_000n) });
  });
  afterAll(async () => { await app.close(); await close(); const a = new Client({ connectionString: BASE }); await a.connect(); await a.query(`DROP DATABASE ${name}`); await a.end(); });
  const get = async (url: string) => { const r = await app.inject({ method: "GET", url }); return { status: r.statusCode, body: r.json() }; };

  it("/coins default sort = volume24h, amounts as base+ui+usd, progress and mcap derived", async () => {
    const { status, body } = await get("/coins");
    expect(status).toBe(200);
    expect(body.coins.map((c: { symbol: string }) => c.symbol)).toEqual(["ALPHA", "BETA"]);
    const a = body.coins[0];
    expect(a.volume24h).toEqual({ base: "300000", ui: "0.003", usd: "300.00" }); // t2 is older than 24h
    expect(a.curveProgressBps).toBe(5000);
    expect(BigInt(a.mcap.base)).toBe((10_164_384n * 1_000_000_000_000_000n) / 1_072_999_000_000_000n);
    expect(a.paysHolders).toBe(false);
    expect(body.btcUsd).toBe("10000000");
  });
  it("/coins sorts and filters", async () => {
    expect((await get("/coins?sort=newest")).body.coins[0].symbol).toBe("BETA");
    expect((await get("/coins?sort=pays_holders")).body.coins[0].symbol).toBe("BETA");
    expect((await get("/coins?stage=dust")).body.coins.map((c: { symbol: string }) => c.symbol)).toEqual(["BETA"]);
    expect((await get("/coins?pays_holders=true")).body.total).toBe(1);
    expect((await get("/coins?sort=bogus")).status).toBe(400);
    expect((await get("/coins?limit=1&offset=1")).body.coins).toHaveLength(1);
  });
  it("/coins/:mint detail with fee totals and account links; 404 unknown", async () => {
    const { body } = await get(`/coins/${m1}`);
    expect(body.fees).toMatchObject({ settles: 1, creatorFee: { base: "10000", ui: "0.0001", usd: "10.00" }, liquidity: { base: "2500" } });
    expect(body.accounts.coinFee).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect((await get(`/coins/${Keypair.generate().publicKey.toBase58()}`)).status).toBe(404);
  });
  it("/coins/:mint/trades newest first; /holders only positive balances by size; /rewards empty", async () => {
    const t = (await get(`/coins/${m1}/trades`)).body.trades;
    expect(t.map((x: { signature: string }) => x.signature)).toEqual(["t2", "t1"]);
    expect(t[1].tokens).toEqual({ base: "1000000000", ui: "1000" });
    const h = (await get(`/coins/${m1}/holders`)).body.holders;
    expect(h.map((x: { wallet: string }) => x.wallet)).toEqual(["A", "C"]);
    expect((await get(`/coins/${m1}/rewards`)).body.runs).toEqual([]);
  });
  it("/ledger with type filter; /stats totals", async () => {
    expect((await get("/ledger")).body.entries).toHaveLength(2);
    const l = (await get("/ledger?type=settle")).body.entries;
    expect(l).toHaveLength(1);
    expect(l[0].amounts.fee).toEqual({ base: "10000", ui: "0.0001" });
    const s = (await get("/stats")).body;
    expect(s).toMatchObject({ coinsLaunched: 2, btcIntoLiquidity: { base: "2500" }, btcPaidToHolders: { base: "777" }, btcTradedToday: { base: "300100" }, tradesToday: 2 });
  });
  it("CORS: allowlisted origin gets headers, others do not; OPTIONS is 204", async () => {
    const strict = await buildApp({ db, prices: new FixedPriceProvider(1n), corsOrigins: ["http://app.test"] });
    const ok = await strict.inject({ method: "GET", url: "/stats", headers: { origin: "http://app.test" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://app.test");
    const no = await strict.inject({ method: "GET", url: "/stats", headers: { origin: "http://evil.test" } });
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await strict.inject({ method: "OPTIONS", url: "/stats", headers: { origin: "http://app.test" } })).statusCode).toBe(204);
    await strict.close();
  });
  it("rate limits", async () => {
    const tight = await buildApp({ db, prices: new FixedPriceProvider(1n), rateLimitPerMinute: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await tight.inject({ method: "GET", url: "/stats" })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    await tight.close();
  });

  it("M6: /reserve lists LP runs with totals and /stats counts burned $SATPAD from confirmed buyback rows", async () => {
    await db.insert(lpRuns).values([{ signature: "lp1", btcDrawn: "2021", satpadBought: "14827511324", lpMinted: "3803878", lpBurned: "3803878", poolReservesAfter: { base: "1", quote: "2" }, slot: 10n, ranAt: new Date() }]);
    await db.insert(ledger).values([
      { type: "buyback", actor: "B", amounts: { sats: "2015", tokens: "33126834583", burned: "33126834583" }, status: "confirmed", attempts: 1 },
      { type: "buyback", actor: "B", amounts: { sats: "1", tokens: "5", burned: "5" }, status: "failed", attempts: 1 },
    ]);
    const r = await app.inject({ method: "GET", url: "/reserve" });
    expect(r.statusCode).toBe(200);
    expect(r.json().totals).toMatchObject({ runs: 1, lpMinted: "3803878", lpBurned: "3803878", netLpSupplyChange: "0" });
    expect(r.json().runs[0]).toMatchObject({ signature: "lp1", lpBurned: "3803878" });
    // ledger rows may carry non-numeric amounts (collect `venue`): formatted amounts for numbers, strings pass through
    await db.insert(ledger).values([{ type: "collect_creator_fee", mint: "M9", actor: "k", amounts: { unclaimed: "12522", venue: "pool" }, status: "confirmed", attempts: 1 }]);
    const l = await app.inject({ method: "GET", url: "/ledger?type=collect_creator_fee" });
    expect(l.statusCode).toBe(200);
    expect(l.json().entries[0].amounts).toMatchObject({ venue: "pool", unclaimed: { base: "12522" } });
    const s = await app.inject({ method: "GET", url: "/stats" });
    expect(s.json().satpadBurned).toMatchObject({ base: "33126834583" });
  });
});

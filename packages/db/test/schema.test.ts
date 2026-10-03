import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { DEFAULT_LOCAL_DATABASE_URL, coins, connect, fees, holders, keeperHealth, ledger, processedTx, trades, type Db } from "../src";
import { runMigrations } from "../src/migrate";

const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
const TEST_DB = `satpad_test_${process.pid}`;
const testUrl = () => BASE.replace(/\/[^/]+$/, `/${TEST_DB}`);

async function reachable(): Promise<boolean> {
  const c = new Client({ connectionString: BASE });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

describe("@satpad/db schema", async () => {
  const up = await reachable();
  if (!up) {
    it.skip(`Postgres not reachable at ${BASE.replace(/:[^:@]+@/, ":***@")} — start it with: docker run -d --name satpad-postgres -e POSTGRES_USER=satpad -e POSTGRES_PASSWORD=satpad -e POSTGRES_DB=satpad -p 55433:5432 postgres:16-alpine`, () => {});
    return;
  }
  let db: Db, close: () => Promise<void>;
  beforeAll(async () => {
    const admin = new Client({ connectionString: BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    await runMigrations(testUrl());
    ({ db, close } = connect(testUrl()));
  });
  afterAll(async () => {
    await close();
    const admin = new Client({ connectionString: BASE });
    await admin.connect();
    await admin.query(`DROP DATABASE ${TEST_DB}`);
    await admin.end();
  });

  it("migrations create the tables and a ledger row goes built → sent → confirmed", async () => {
    await db.insert(coins).values({ mint: "M1", deployer: "D", payee: "D", payeeMode: "wallet", bondingCurve: "BC", createdAt: new Date() });
    const [row] = await db.insert(ledger).values({ type: "settle", mint: "M1", actor: "keeper", amounts: { fee: "10", liquidity: "3" } }).returning();
    expect(row!.status).toBe("built");
    expect(row!.amounts).toEqual({ fee: "10", liquidity: "3" });
    await db.update(ledger).set({ status: "sent", signature: "sig1", attempts: 1 }).where(eq(ledger.id, row!.id));
    await db.update(ledger).set({ status: "confirmed", slot: 12345n, confirmedAt: new Date() }).where(eq(ledger.id, row!.id));
    const [after] = await db.select().from(ledger).where(eq(ledger.id, row!.id));
    expect(after!.status).toBe("confirmed");
    expect(after!.slot).toBe(12345n);
    expect(after!.signature).toBe("sig1");
  });

  it("amounts are strings, never numbers (bigint safety)", async () => {
    const big = (2n ** 64n - 1n).toString();
    const [row] = await db.insert(ledger).values({ type: "draw_lp", actor: "lp", amounts: { amount: big } }).returning();
    expect(row!.amounts["amount"]).toBe(big);
    expect(BigInt(row!.amounts["amount"]!)).toBe(2n ** 64n - 1n);
  });

  it("keeper_health upserts per loop/instance", async () => {
    const now = new Date();
    await db.insert(keeperHealth).values({ loop: "settle", instance: "test", lastOkAt: now });
    await db.insert(keeperHealth).values({ loop: "settle", instance: "test", lastOkAt: now, consecutiveFailures: 2, lastError: "x" })
      .onConflictDoUpdate({ target: [keeperHealth.loop, keeperHealth.instance], set: { consecutiveFailures: 2, lastError: "x" } });
    const rows = await db.select().from(keeperHealth);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consecutiveFailures).toBe(2);
  });

  it("M4 tables: trades keyed by (signature, ix), holders upsert, fees, processed_tx idempotency, numeric amounts as strings", async () => {
    await db.insert(coins).values({ mint: "M4", deployer: "D", payee: "D", payeeMode: "wallet", bondingCurve: "BC", createdAt: new Date() }).onConflictDoNothing();
    await db.insert(trades).values([
      { signature: "s1", ixIndex: 0, mint: "M4", side: "buy", btcAmount: "123", tokenAmount: "1000000000", priceBtcScaled: "123000000000000", trader: "T", slot: 10n, venue: "curve" },
      { signature: "s1", ixIndex: 1, mint: "M4", side: "sell", btcAmount: "45", tokenAmount: "500000000", priceBtcScaled: "90000000000000", trader: "T", slot: 10n, venue: "curve" },
    ]);
    await expect(db.insert(trades).values({ signature: "s1", ixIndex: 0, mint: "M4", side: "buy", btcAmount: "1", tokenAmount: "1", priceBtcScaled: "1", trader: "T", slot: 10n, venue: "curve" })).rejects.toThrow();
    const big = (2n ** 64n - 1n).toString(); // u64 max; numeric(30,0) also fits products of two u64s
    await db.insert(holders).values({ mint: "M4", wallet: "W", balance: big, updatedSlot: 10n }).onConflictDoUpdate({ target: [holders.mint, holders.wallet], set: { balance: "5", updatedSlot: 11n } });
    await db.insert(holders).values({ mint: "M4", wallet: "W", balance: "7", updatedSlot: 12n }).onConflictDoUpdate({ target: [holders.mint, holders.wallet], set: { balance: "7", updatedSlot: 12n } });
    const [h] = await db.select().from(holders);
    expect(h!.balance).toBe("7");
    expect(h!.updatedSlot).toBe(12n);
    await db.insert(fees).values({ signature: "f1", mint: "M4", creatorFeeBtc: big, liquidity: "1", buyback: "1", operator: "1", deployer: "1", slot: 10n });
    expect((await db.select().from(fees))[0]!.creatorFeeBtc).toBe(big);
    await db.insert(processedTx).values({ signature: "s1", slot: 10n });
    const dup = await db.insert(processedTx).values({ signature: "s1", slot: 10n }).onConflictDoNothing().returning();
    expect(dup).toHaveLength(0);
  });

  it("rejects an unknown ledger type (enum)", async () => {
    await expect(db.insert(ledger).values({ type: "bogus" as never, actor: "x" })).rejects.toThrow();
  });
});

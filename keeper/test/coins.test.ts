import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import { SATPAD_VAULT_PROGRAM_ID, VAULT_IDL, coinPda } from "@satpad/sdk";
import { discoverCoins, type CoinRpc } from "../src/coins";

const coder = new BorshCoder(VAULT_IDL);
async function encodedCoin(mint: PublicKey, mode: "Wallet" | "Holders" = "Wallet", paused = false): Promise<Buffer> {
  const k = Keypair.generate().publicKey;
  return coder.accounts.encode("Coin", { mint, deployer: k, payee: mode === "Wallet" ? k : PublicKey.default, payee_mode: { [mode]: {} }, paused, created_at: new BN(1_750_000_000), declared: true, treasury_only: false, last_rewards_run_ts: new BN(0), rewards_run_count: new BN(0), bump: 1, coin_fee_bump: 2, payee_pot_bump: 3, rewards_pot_bump: 4 });
}

describe("discoverCoins", () => {
  it("filters on the Coin discriminator, decodes, skips garbage, sorts by mint", async () => {
    const m1 = Keypair.generate().publicKey, m2 = Keypair.generate().publicKey;
    const rows = [
      { pubkey: coinPda(m1)[0], account: { data: await encodedCoin(m1, "Holders", true), owner: SATPAD_VAULT_PROGRAM_ID, executable: false, lamports: 1 } },
      { pubkey: coinPda(m2)[0], account: { data: await encodedCoin(m2), owner: SATPAD_VAULT_PROGRAM_ID, executable: false, lamports: 1 } },
      { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from("not a coin"), owner: SATPAD_VAULT_PROGRAM_ID, executable: false, lamports: 1 } },
    ];
    let filters: unknown;
    const rpc: CoinRpc = { getProgramAccounts: (async (_pid: PublicKey, cfg: { filters: unknown }) => { filters = cfg.filters; return rows; }) as never };
    const found = await discoverCoins(rpc);
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.mint.toBase58())).toEqual([m1, m2].map((m) => m.toBase58()).sort());
    const holders = found.find((c) => c.mint.equals(m1))!;
    expect(holders.payeeMode).toBe("holders");
    expect(holders.paused).toBe(true);
    expect(holders.address.equals(coinPda(m1)[0])).toBe(true);
    expect(JSON.stringify(filters)).toContain('"offset":0');
  });
});

describe("upsertCoins (Postgres)", async () => {
  const { Client } = await import("pg");
  const { DEFAULT_LOCAL_DATABASE_URL, coins, connect } = await import("@satpad/db");
  const { runMigrations } = await import("@satpad/db/src/migrate");
  const { upsertCoins } = await import("../src/coins");
  const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
  const up = await (async () => { const c = new Client({ connectionString: BASE }); try { await c.connect(); await c.end(); return true; } catch { return false; } })();
  if (!up) { it.skip("Postgres not reachable", () => {}); return; }
  const name = `satpad_keeper_${process.pid}`;
  const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  it("inserts then updates by mint without touching indexer-owned columns", async () => {
    const admin = new Client({ connectionString: BASE }); await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
    await runMigrations(url);
    const { db, close } = connect(url);
    try {
      const m = Keypair.generate().publicKey;
      const base = { address: coinPda(m)[0], mint: m, deployer: Keypair.generate().publicKey, payee: Keypair.generate().publicKey, payeeMode: "wallet" as const, paused: false, createdAt: 1_750_000_000n, declared: true, treasuryOnly: false, lastRewardsRunTs: 0n, rewardsRunCount: 0n };
      expect(await upsertCoins(db, [base], 10n)).toBe(1);
      await db.update(coins).set({ name: "Indexer Named" });
      const newPayee = Keypair.generate().publicKey;
      await upsertCoins(db, [{ ...base, payee: newPayee, paused: true }], 20n);
      const [row] = await db.select().from(coins);
      expect(row!.payee).toBe(newPayee.toBase58());
      expect(row!.paused).toBe(true);
      expect(row!.updatedSlot).toBe(20n);
      expect(row!.name).toBe("Indexer Named");
      expect(row!.createdAt.getTime()).toBe(1_750_000_000_000);
    } finally {
      await close();
      const admin2 = new Client({ connectionString: BASE }); await admin2.connect(); await admin2.query(`DROP DATABASE ${name}`); await admin2.end();
    }
  });
});

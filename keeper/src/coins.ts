// Registered-coin discovery. Until the indexer (M4) exists the keeper lists satpad_vault `Coin` accounts directly via
// getProgramAccounts filtered on the account discriminator, decodes them with the SDK, and mirrors the registry subset
// into the `coins` table so the Ledger/API can join on it. Idempotent: upserts by mint.
import type { Connection, PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { SATPAD_VAULT_PROGRAM_ID, VAULT_IDL, decodeCoin, type Coin } from "@satpad/sdk";
import { coins, type Db } from "@satpad/db";
import { sql } from "drizzle-orm";
import bs58 from "bs58";

export interface RegisteredCoin extends Coin { address: PublicKey }

const COIN_DISCRIMINATOR: number[] = (VAULT_IDL as unknown as { accounts: { name: string; discriminator: number[] }[] }).accounts.find((a) => a.name === "Coin")!.discriminator;

export type CoinRpc = Pick<Connection, "getProgramAccounts">;

/** All `Coin` accounts owned by the vault program. */
export async function discoverCoins(rpc: CoinRpc, programId = SATPAD_VAULT_PROGRAM_ID): Promise<RegisteredCoin[]> {
  const accounts = await rpc.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(COIN_DISCRIMINATOR)) } }],
  });
  const out: RegisteredCoin[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      out.push({ ...decodeCoin(account.data), address: pubkey });
    } catch {
      // Not a Coin after all (discriminator collision or a newer layout) — skip, never crash the loop.
    }
  }
  return out.sort((a, b) => a.mint.toBase58().localeCompare(b.mint.toBase58()));
}

/** Mirrors the registry subset into `coins`. Fields the indexer owns (name, stage, pool, …) are left untouched. */
export async function upsertCoins(db: Db, list: RegisteredCoin[], slot: bigint): Promise<number> {
  if (list.length === 0) return 0;
  await db.insert(coins).values(list.map((c) => ({
    mint: c.mint.toBase58(), deployer: c.deployer.toBase58(), payee: c.payee.toBase58(), payeeMode: c.payeeMode, treasuryOnly: c.treasuryOnly,
    bondingCurve: bondingCurvePda(c.mint).toBase58(), createdAt: new Date(Number(c.createdAt) * 1000), paused: c.paused, updatedSlot: slot,
  }))).onConflictDoUpdate({
    target: coins.mint,
    set: { payee: sql`excluded.payee`, payeeMode: sql`excluded.payee_mode`, paused: sql`excluded.paused`, updatedSlot: sql`excluded.updated_slot` },
  });
  return list.length;
}

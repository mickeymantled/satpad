// Holders sweep: rebuild a coin's holder balances from a fresh getProgramAccounts read of its Token-2022 accounts.
// Covers what balance deltas cannot: launches that predate the indexer (or the node's history) and any drift. Runs on
// registration and every HOLDER_SWEEP_INTERVAL_MS per coin through the rate limiter (one RPC call per coin).
import type { Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { and, eq, gt, notInArray, sql } from "drizzle-orm";
import { coins, holders, type Db } from "@satpad/db";
import type { TokenBucket } from "./ratelimit";

export type SweepRpc = Pick<Connection, "getParsedProgramAccounts" | "getSlot">;

export async function sweepHolders(rpc: SweepRpc, bucket: TokenBucket, db: Db, mint: string, bondingCurve: string, pool: string | null): Promise<{ wallets: number; positive: number }> {
  await bucket.take();
  const slot = BigInt(await rpc.getSlot("confirmed"));
  await bucket.take();
  const accounts = await rpc.getParsedProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint } }] });
  const balances = new Map<string, bigint>();
  for (const a of accounts) {
    const info = (a.account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
    if (!info?.owner || !info.tokenAmount?.amount) continue;
    if (info.owner === bondingCurve || (pool && info.owner === pool)) continue;
    balances.set(info.owner, (balances.get(info.owner) ?? 0n) + BigInt(info.tokenAmount.amount));
  }
  await db.transaction(async (t) => {
    const wallets = [...balances.keys()];
    if (wallets.length) {
      await t.insert(holders).values(wallets.map((w) => ({ mint, wallet: w, balance: balances.get(w)!.toString(), updatedSlot: slot })))
        .onConflictDoUpdate({ target: [holders.mint, holders.wallet], set: { balance: sql`excluded.balance`, updatedSlot: sql`excluded.updated_slot` }, setWhere: sql`${holders.updatedSlot} <= excluded.updated_slot` });
      // wallets no longer holding any account for this mint
      await t.update(holders).set({ balance: "0", updatedSlot: slot }).where(and(eq(holders.mint, mint), notInArray(holders.wallet, wallets), gt(holders.balance, "0")));
    } else {
      await t.update(holders).set({ balance: "0", updatedSlot: slot }).where(and(eq(holders.mint, mint), gt(holders.balance, "0")));
    }
    const positive = [...balances.values()].filter((b) => b > 0n).length;
    await t.update(coins).set({ holderCount: positive }).where(eq(coins.mint, mint));
  });
  return { wallets: balances.size, positive: [...balances.values()].filter((b) => b > 0n).length };
}

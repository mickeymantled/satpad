// M6 definition of done (SPEC milestone 6): "LP mint supply is net zero after ten runs". Reads the keeper's ledger and
// the indexer's lp_runs for a stack, then checks on chain that the Reserve pool's LP mint supply is still zero (every LP
// token the ten deposits minted was burned in the same transaction) and that the pool's own LP counter grew by what was
// minted. Exit 1 on any problem. Usage: LOCAL_RPC_URL=... DATABASE_URL=... npx tsx scripts/fork-lp-check.ts [--min-runs 10] [--json out.json]
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { desc, eq } from "drizzle-orm";
import { connect, keeperHealth, ledger, lpRuns } from "@satpad/db";
import { LP_TOKEN_PROGRAM, decodePool } from "@satpad/sdk";
import { arg, fetchConfig } from "./lib/cli";
import { RPC } from "./lib/fork";

async function main() {
  const minRuns = Number(arg("min-runs") ?? 10);
  const conn = new Connection(RPC, "confirmed");
  const { db, close } = connect();
  const problems: string[] = [];
  try {
    const config = await fetchConfig(conn);
    if (!config || config.satpadPool.equals(PublicKey.default)) throw new Error("Config.satpad_pool not set");
    const rows = await db.select().from(ledger).where(eq(ledger.type, "lp_deposit")).orderBy(desc(ledger.id));
    const confirmed = rows.filter((r) => r.status === "confirmed"), failed = rows.filter((r) => r.status === "failed");
    if (confirmed.length < minRuns) problems.push(`only ${confirmed.length} confirmed lp_deposit rows (need ${minRuns})`);
    if (failed.length > 0) problems.push(`${failed.length} failed lp_deposit rows: ${failed.map((r) => r.error).join("; ").slice(0, 200)}`);
    let mintedLedger = 0n, burnedLedger = 0n, drawnLedger = 0n;
    for (const r of confirmed) {
      const a = r.amounts as Record<string, string>;
      if (a["lpMinted"] !== a["lpBurned"]) problems.push(`ledger ${r.id}: lpMinted ${a["lpMinted"]} ≠ lpBurned ${a["lpBurned"]}`);
      if (BigInt(a["drawn"] ?? "0") > config.lpDrawMax) problems.push(`ledger ${r.id}: drawn ${a["drawn"]} > lp_draw_max ${config.lpDrawMax}`);
      mintedLedger += BigInt(a["lpMinted"] ?? "0"); burnedLedger += BigInt(a["lpBurned"] ?? "0"); drawnLedger += BigInt(a["drawn"] ?? "0");
    }
    const runs = await db.select().from(lpRuns).orderBy(desc(lpRuns.slot));
    let mintedIdx = 0n, burnedIdx = 0n;
    for (const r of runs) { mintedIdx += BigInt(r.lpMinted); burnedIdx += BigInt(r.lpBurned); if (r.lpMinted !== r.lpBurned) problems.push(`lp_runs ${r.signature}: minted ${r.lpMinted} ≠ burned ${r.lpBurned}`); }
    const health = await db.select().from(keeperHealth).where(eq(keeperHealth.loop, "lp"));
    for (const h of health) if (h.consecutiveFailures > 0) problems.push(`keeper ${h.instance} lp loop has ${h.consecutiveFailures} consecutive failures: ${h.lastError}`);
    const poolInfo = await conn.getAccountInfo(config.satpadPool, "confirmed");
    if (!poolInfo) throw new Error("pool account missing");
    const pool = decodePool(poolInfo.data);
    const supply = (await getMint(conn, pool.lpMint, "confirmed", LP_TOKEN_PROGRAM)).supply;
    if (supply !== 0n) problems.push(`LP mint supply on chain is ${supply}, expected 0 (net zero after every run)`);
    if (!pool.lpMint.equals(config.satpadLpMint)) problems.push(`pool lp mint ${pool.lpMint.toBase58()} ≠ Config.satpad_lp_mint`);
    const [baseRes, quoteRes] = await Promise.all([conn.getTokenAccountBalance(pool.poolBaseTokenAccount, "confirmed"), conn.getTokenAccountBalance(pool.poolQuoteTokenAccount, "confirmed")]);
    const out = {
      rpc: RPC, pool: config.satpadPool.toBase58(), lpMint: pool.lpMint.toBase58(), runsConfirmed: confirmed.length, runsFailed: failed.length, runsIndexed: runs.length,
      drawnSats: drawnLedger.toString(), lpMintedLedger: mintedLedger.toString(), lpBurnedLedger: burnedLedger.toString(), lpMintedIndexed: mintedIdx.toString(), lpBurnedIndexed: burnedIdx.toString(),
      lpMintSupplyOnChain: supply.toString(), poolLpCounter: pool.lpSupply.toString(), poolReserves: { base: baseRes.value.amount, quote: quoteRes.value.amount },
      definitionOfDone: problems.length === 0 && confirmed.length >= minRuns ? "MET" : "NOT MET", problems,
    };
    console.log(JSON.stringify(out, null, 2));
    if (arg("json")) writeFileSync(arg("json")!, JSON.stringify(out, null, 2));
    if (out.definitionOfDone !== "MET") process.exit(1);
  } finally { await close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });

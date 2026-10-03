// M3 reconciler: the `ledger` table must match the chain exactly (SPEC M3 DoD). Two directions:
//  1. every confirmed ledger row (settle / pay_payee / collect) has a finalized on-chain transaction whose satpad_vault
//     event (Settled / PayeePaid) carries the same mint and amounts;
//  2. every Settled / PayeePaid event emitted by the vault program on chain (any signer) has exactly one confirmed
//     ledger row with that signature — nothing settled outside the keeper's books, nothing double-counted.
// Also reports failed rows and per-coin lag (seconds between a coin's last trade and its settle). Exit 1 on any drift.
// Usage: DATABASE_URL=... pnpm fork:check [--since-slot N] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { inArray } from "drizzle-orm";
import { connect, ledger } from "@satpad/db";
import { SATPAD_VAULT_PROGRAM_ID, parseVaultEvents } from "@satpad/sdk";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { RPC } from "./lib/fork";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

interface ChainEvent { signature: string; slot: number; name: string; mint: string; amounts: Record<string, string>; blockTime: number | null }

async function chainEvents(conn: Connection, sinceSlot: number): Promise<ChainEvent[]> {
  const out: ChainEvent[] = [];
  let before: string | undefined;
  for (;;) {
    const sigs = await conn.getSignaturesForAddress(SATPAD_VAULT_PROGRAM_ID, { limit: 1000, ...(before && { before }) }, "confirmed");
    if (sigs.length === 0) break;
    for (const s of sigs) {
      if (s.slot < sinceSlot) return out;
      if (s.err) continue;
      const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      for (const e of parseVaultEvents(tx?.meta?.logMessages ?? [])) {
        if (e.name !== "Settled" && e.name !== "PayeePaid") continue;
        const d = e.data as Record<string, { toString(): string }>;
        const amounts = e.name === "Settled"
          ? { fee: d["amount"]!.toString(), liquidity: d["liquidity"]!.toString(), buyback: d["buyback"]!.toString(), operator: d["operator"]!.toString(), deployer: d["deployer"]!.toString() }
          : { amount: d["amount"]!.toString() };
        out.push({ signature: s.signature, slot: s.slot, name: e.name, mint: (d["mint"] as unknown as PublicKey).toBase58(), amounts, blockTime: s.blockTime ?? null });
      }
    }
    before = sigs[sigs.length - 1]!.signature;
    if (sigs.length < 1000) break;
  }
  return out;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  // solana-test-validator retains only a short window of blocks; anything older is unverifiable, not drift.
  const firstAvailable = await conn.getFirstAvailableBlock();
  const requested = Number(arg("since-slot") ?? 0);
  const sinceSlot = Math.max(requested, firstAvailable);
  const { db, close } = connect();
  const problems: string[] = [];
  try {
    const allRows = await db.select().from(ledger).where(inArray(ledger.type, ["settle", "pay_payee", "collect_creator_fee"]));
    const purged = allRows.filter((r) => r.slot !== null && Number(r.slot) < sinceSlot);
    const rows = allRows.filter((r) => r.slot === null || Number(r.slot) >= sinceSlot);
    const events = await chainEvents(conn, sinceSlot);
    const bySig = new Map(events.map((e) => [e.signature, e]));
    const typeOf = { Settled: "settle", PayeePaid: "pay_payee" } as const;

    // 1. ledger → chain
    const IN_FLIGHT_MS = 90_000; // a `built`/`sent` row younger than this is a transaction still confirming, not drift
    let inFlight = 0;
    for (const r of rows) {
      if (r.status === "failed") { problems.push(`ledger ${r.id} ${r.type} ${r.mint} FAILED: ${r.error}`); continue; }
      if (r.status !== "confirmed") {
        if (Date.now() - r.createdAt.getTime() < IN_FLIGHT_MS) { inFlight++; continue; }
        problems.push(`ledger ${r.id} ${r.type} ${r.mint} stuck in status ${r.status} for > ${IN_FLIGHT_MS / 1000}s`);
        continue;
      }
      if (!r.signature) { problems.push(`ledger ${r.id} confirmed without a signature`); continue; }
      if (r.type === "collect_creator_fee") {
        const tx = await conn.getTransaction(r.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!tx || tx.meta?.err) problems.push(`ledger ${r.id} collect ${r.signature} not found on chain or errored`);
        continue;
      }
      const e = bySig.get(r.signature);
      if (!e) { problems.push(`ledger ${r.id} ${r.type} ${r.signature}: no ${r.type} event on chain`); continue; }
      if (e.mint !== r.mint) problems.push(`ledger ${r.id}: mint ${r.mint} vs chain ${e.mint}`);
      for (const [k, v] of Object.entries(e.amounts)) if (r.amounts[k] !== v) problems.push(`ledger ${r.id} ${r.type} ${k}: ledger ${r.amounts[k]} vs chain ${v}`);
    }
    // 2. chain → ledger
    for (const e of events) {
      const matches = rows.filter((r) => r.signature === e.signature && r.type === typeOf[e.name as keyof typeof typeOf] && r.status === "confirmed");
      if (matches.length !== 1) problems.push(`chain ${e.name} ${e.signature} (${e.mint}): ${matches.length} confirmed ledger rows`);
    }

    // lag: last trade (buy/sell on the curve) → settle, per coin, from chain timestamps
    const settled = events.filter((e) => e.name === "Settled");
    const lagByMint: Record<string, number> = {};
    for (const e of settled) {
      if (!e.blockTime) continue;
      const lastTrade = await lastTradeBefore(conn, new PublicKey(e.mint), e.slot);
      if (lastTrade) lagByMint[e.mint] = Math.max(lagByMint[e.mint] ?? 0, e.blockTime - lastTrade);
    }
    const lags = Object.values(lagByMint);
    // Rolling sidecar (scripts/fork-rolling-check.sh) accumulates verified windows while history is still retained.
    let rolling: Record<string, unknown> | null = null;
    try { rolling = JSON.parse(readFileSync(".fork-ledger/soak-rolling.json", "utf8")); } catch { /* none */ }
    const summary = {
      rpc: RPC, requestedSinceSlot: requested, firstAvailableBlock: firstAvailable, sinceSlot,
      ledgerRowsTotal: allRows.length, ledgerRowsChecked: rows.length, ledgerRowsOlderThanRetainedHistory: purged.length,
      chainEvents: events.length, settles: settled.length, payouts: events.length - settled.length,
      failedRows: allRows.filter((r) => r.status === "failed").length, inFlightRows: inFlight, maxLagS: lags.length ? Math.max(...lags) : null, avgLagS: lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null,
      rolling, problems,
    };
    console.log(JSON.stringify(summary, null, 2));
    const out = arg("json");
    if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
    const rollingProblems = Number((rolling as { problems?: number } | null)?.problems ?? 0);
    if (problems.length || rollingProblems) { console.error(`DRIFT: ${problems.length} problem(s) in this window, ${rollingProblems} accumulated`); process.exit(1); }
    console.log("ledger matches chain" + (purged.length ? ` (${purged.length} rows predate retained history; see rolling sidecar)` : ""));
  } finally {
    await close();
  }
}

/** Block time of the most recent successful pump trade on the coin's curve before `slot`, or null. */
async function lastTradeBefore(conn: Connection, mint: PublicKey, slot: number): Promise<number | null> {
  const sigs = await conn.getSignaturesForAddress(bondingCurvePda(mint), { limit: 50 }, "confirmed");
  const t = sigs.find((s) => !s.err && s.slot < slot);
  return t?.blockTime ?? null;
}
main().catch((e) => { console.error(e); process.exit(1); });

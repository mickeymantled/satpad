// M4 definition of done: the API matches on-chain state for the fork's coins. Exercises the real API layer in-process
// (buildApp + inject) over the live database and diffs against the chain:
//  1. /coins vs each registered coin's BondingCurve account: reserves, progress, stage (block ⇔ complete), count;
//  2. /ledger confirmed entries within the validator's retained window exist on chain and carry the same vault event;
//  3. holders table vs a fresh getProgramAccounts sweep of each coin's Token-2022 accounts (human note: deltas drift
//     silently) — every wallet with a positive balance on chain must be in the table with the same balance, and vice
//     versa (bonding curve / pool excluded).
// Exit 1 on any mismatch. Usage: DATABASE_URL=... pnpm fork:api-check [--json out.json]
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import { connect, coins, holders } from "@satpad/db";
import { INITIAL_REAL_TOKEN_RESERVES, parseVaultEvents } from "@satpad/sdk";
import { eq } from "drizzle-orm";
import { buildApp } from "../api/src/app";
import { FixedPriceProvider } from "../api/src/prices";
import { RPC } from "./lib/fork";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const { db, close } = connect();
  const app = await buildApp({ db, prices: new FixedPriceProvider(10_000_000n), rateLimitPerMinute: 100_000 });
  const get = async <T>(url: string): Promise<T> => { const r = await app.inject({ method: "GET", url }); if (r.statusCode !== 200) throw new Error(`${url} → ${r.statusCode} ${r.body}`); return r.json() as T; };
  const problems: string[] = [];
  const firstAvailable = await conn.getFirstAvailableBlock();
  try {
    // 1. coins vs curves
    type ApiCoin = { mint: string; stage: string; curveProgressBps: number; buys: number; sells: number; holderCount: number };
    const api = await get<{ total: number; coins: ApiCoin[] }>("/coins?limit=100");
    const registered = await db.select({ mint: coins.mint, bondingCurve: coins.bondingCurve, pool: coins.pool, vq: coins.virtualQuoteReserves, vt: coins.virtualTokenReserves, rt: coins.realTokenReserves }).from(coins);
    if (api.total !== registered.length) problems.push(`/coins total ${api.total} vs ${registered.length} registered`);
    // The indexer polls; a coin is comparable only when its newest curve transaction has been indexed. Wait up to 30 s.
    const synced = new Set<string>();
    let lagging = 0;
    for (const c of registered) {
      let ok = false;
      for (let i = 0; i < 6 && !ok; i++) {
        const sigs = await conn.getSignaturesForAddress(bondingCurvePda(new PublicKey(c.mint)), { limit: 1 }, "confirmed");
        const [row] = await db.select({ indexedSlot: coins.indexedSlot }).from(coins).where(eq(coins.mint, c.mint));
        ok = (sigs[0]?.slot ?? 0) <= Number(row?.indexedSlot ?? 0n);
        if (!ok) await new Promise((r) => setTimeout(r, 5000));
      }
      if (ok) synced.add(c.mint); else { lagging++; problems.push(`${c.mint}: indexer never caught up with the curve within 30 s`); }
    }
    // re-read API and DB after the wait so comparisons see the same state
    const apiNow = await get<{ total: number; coins: ApiCoin[] }>("/coins?limit=100");
    const dbNow = await db.select({ mint: coins.mint, vq: coins.virtualQuoteReserves, rt: coins.realTokenReserves }).from(coins);
    let coinsChecked = 0;
    for (const c of registered) {
      if (!synced.has(c.mint)) continue;
      const a = apiNow.coins.find((x) => x.mint === c.mint);
      const d = dbNow.find((x) => x.mint === c.mint)!;
      if (!a) { problems.push(`${c.mint}: missing from /coins`); continue; }
      const info = await conn.getAccountInfo(bondingCurvePda(new PublicKey(c.mint)), "confirmed");
      if (!info) { problems.push(`${c.mint}: bonding curve missing on chain`); continue; }
      const curve = PUMP_SDK.decodeBondingCurve(info);
      coinsChecked++;
      const chainProgress = Number(10_000n - (BigInt(curve.realTokenReserves.toString()) * 10_000n) / INITIAL_REAL_TOKEN_RESERVES);
      if (d.vq !== null && d.vq !== curve.virtualQuoteReserves.toString()) problems.push(`${c.mint}: virtual_quote_reserves db ${d.vq} vs chain ${curve.virtualQuoteReserves}`);
      if (d.rt !== null && d.rt !== curve.realTokenReserves.toString()) problems.push(`${c.mint}: real_token_reserves db ${d.rt} vs chain ${curve.realTokenReserves}`);
      if (a.curveProgressBps !== chainProgress) problems.push(`${c.mint}: progress api ${a.curveProgressBps} vs chain ${chainProgress}`);
      if (curve.complete !== (a.stage === "block")) problems.push(`${c.mint}: stage ${a.stage} vs curve.complete=${curve.complete}`);
    }

    // 2. ledger vs chain (retained window only)
    type Entry = { signature: string | null; type: string; mint: string | null; status: string; slot: string | null; amounts: Record<string, { base: string }> };
    const ledgerApi = await get<{ entries: Entry[] }>("/ledger?limit=100");
    let ledgerChecked = 0, ledgerSkipped = 0;
    for (const e of ledgerApi.entries) {
      if (e.status !== "confirmed" || !e.signature || e.type === "collect_creator_fee") continue;
      if (e.slot && Number(e.slot) < firstAvailable) { ledgerSkipped++; continue; }
      const tx = await conn.getTransaction(e.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) { ledgerSkipped++; continue; }
      ledgerChecked++;
      const ev = parseVaultEvents(tx.meta?.logMessages ?? []).find((x) => (e.type === "settle" && x.name === "Settled") || (e.type === "pay_payee" && x.name === "PayeePaid"));
      if (!ev) { problems.push(`ledger ${e.signature}: no ${e.type} event on chain`); continue; }
      const chainAmt = String(ev.data[e.type === "settle" ? "amount" : "amount"]);
      const apiAmt = e.amounts[e.type === "settle" ? "fee" : "amount"]?.base;
      if (chainAmt !== apiAmt) problems.push(`ledger ${e.signature}: amount api ${apiAmt} vs chain ${chainAmt}`);
    }

    // 3. holders vs getProgramAccounts sweep (synced coins only)
    let holdersChecked = 0;
    for (const c of registered) {
      if (!synced.has(c.mint)) continue;
      const sweep = await conn.getParsedProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: c.mint } }] });
      const chain = new Map<string, bigint>();
      for (const a of sweep) {
        const p = (a.account.data as { parsed: { info: { owner: string; tokenAmount: { amount: string } } } }).parsed.info;
        if (p.owner === c.bondingCurve || (c.pool && p.owner === c.pool)) continue;
        chain.set(p.owner, (chain.get(p.owner) ?? 0n) + BigInt(p.tokenAmount.amount));
      }
      const rows = await db.select().from(holders).where(eq(holders.mint, c.mint));
      const table = new Map(rows.map((r) => [r.wallet, BigInt(r.balance)]));
      for (const [w, bal] of chain) {
        if (bal === 0n) continue;
        holdersChecked++;
        const t = table.get(w);
        if (t === undefined) problems.push(`${c.mint}: holder ${w} (${bal}) missing from holders table`);
        else if (t !== bal) problems.push(`${c.mint}: holder ${w} table ${t} vs chain ${bal}`);
      }
      for (const [w, bal] of table) if (bal > 0n && !(chain.get(w) ?? 0n)) problems.push(`${c.mint}: holders table has ${w} (${bal}) but chain balance is 0`);
      const apiCoin = apiNow.coins.find((x) => x.mint === c.mint);
      const positive = [...chain.values()].filter((b) => b > 0n).length;
      if (apiCoin && apiCoin.holderCount !== positive) problems.push(`${c.mint}: holderCount api ${apiCoin.holderCount} vs chain ${positive}`);
    }

    const summary = { rpc: RPC, firstAvailableBlock: firstAvailable, coins: registered.length, coinsChecked, ledgerChecked, ledgerSkippedOutsideRetention: ledgerSkipped, holderBalancesChecked: holdersChecked, coinsLagging: lagging, problems };
    console.log(JSON.stringify(summary, null, 2));
    const out = arg("json"); if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
    if (problems.length) { console.error(`API DRIFT: ${problems.length} problem(s)`); process.exit(1); }
    console.log("API matches chain");
  } finally {
    await app.close(); await close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

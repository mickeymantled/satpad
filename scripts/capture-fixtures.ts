// Records real transactions from the fork as JSON fixtures for indexer decoder tests. Read-only, ~10 RPC calls.
// Usage: pnpm fixtures:capture  (needs scripts/fork-keys/seed.json from fork-seed-coins)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { SATPAD_VAULT_PROGRAM_ID } from "@satpad/sdk";
import { RPC } from "./lib/fork";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seed = JSON.parse(readFileSync("scripts/fork-keys/seed.json", "utf8")) as { coins: { mint: string; signature: string }[] };
  mkdirSync("indexer/test/fixtures", { recursive: true });
  const save = async (name: string, sig: string) => {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) throw new Error(`${name}: ${sig} not found`);
    writeFileSync(`indexer/test/fixtures/${name}.json`, JSON.stringify({ signature: sig, ...tx }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log(`${name}: ${sig} slot ${tx.slot} v${tx.version}`);
  };
  const c0 = seed.coins[0]!;
  // The test validator retains only a short block window; the launch tx is long gone on a running soak. Capture it on a
  // fresh fork instead (see indexer/test/fixtures/README.md); here we take whatever the retained window offers, retrying.
  try { await save("launch_v0", c0.signature); } catch { console.log("launch_v0: not in retained history, skipped"); }
  const retry = async <T>(label: string, fn: () => Promise<T | undefined>, tries = 12): Promise<T | undefined> => {
    for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5000)); }
    console.log(`${label}: not found after retries`); return undefined;
  };
  const mints = seed.coins.map((c) => new PublicKey(c.mint));
  let buy: string | undefined, sell: string | undefined;
  const curveSigs = (await Promise.all(mints.slice(0, 4).map((m) => conn.getSignaturesForAddress(bondingCurvePda(m), { limit: 10 }, "confirmed")))).flat();
  for (const s of curveSigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = tx?.meta?.logMessages ?? [];
    const isSell = logs.some((l) => /Instruction: SellV2/.test(l)), isBuy = logs.some((l) => /Instruction: BuyV2/.test(l));
    if (isSell && !sell) sell = s.signature;
    else if (isBuy && !buy && s.signature !== c0.signature) buy = s.signature;
    if (buy && sell) break;
  }
  if (buy) await save("buy_v2", buy);
  if (sell) await save("sell_v2", sell);
  let settle: string | undefined, pay: string | undefined, collect: string | undefined;
  const findVault = async (re: RegExp) => {
    const sigs = await conn.getSignaturesForAddress(SATPAD_VAULT_PROGRAM_ID, { limit: 30 }, "confirmed");
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx && (tx.meta?.logMessages ?? []).some((l) => re.test(l))) return s.signature;
    }
    return undefined;
  };
  settle = await retry("settle", () => findVault(/Instruction: Settle/));
  if (settle) await save("settle", settle);
  pay = await retry("pay_payee", () => findVault(/Instruction: PayPayee/));
  if (pay) await save("pay_payee", pay);
  // a collect_creator_fee_v2 lands on the pump program; find it via the curve's creator vault? cheaper: scan recent pump sigs for the coin's CoinFee ATA
  const { coinAccounts, coinFeePda } = await import("@satpad/sdk");
  const cf = coinFeePda(new PublicKey(c0.mint))[0];
  collect = await retry("collect", async () => {
    for (const m of mints) {
      const cf2 = coinFeePda(m)[0];
      const sigs = await conn.getSignaturesForAddress(coinAccounts(m, cf2).creatorQuoteAta, { limit: 5 }, "confirmed");
      for (const s of sigs) {
        const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (tx && (tx.meta?.logMessages ?? []).some((l) => /Instruction: CollectCreatorFeeV2/.test(l))) return s.signature;
      }
    }
    return undefined;
  });
  void cf;
  if (collect) await save("collect_creator_fee_v2", collect);
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });

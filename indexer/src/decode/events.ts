// Decoders: pump.fun curve events and satpad_vault events from a normalized transaction, plus holder balance deltas.
// Event layouts are the pinned IDLs (idl-ref/pump.json; SDK vault IDL) — VERIFIED V3.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PUMP_PROGRAM_ID, parseVaultEvents } from "@satpad/sdk";
import type { NormalizedTx } from "./tx";

const pumpIdl = JSON.parse(readFileSync(path.resolve(__dirname, "../../../idl-ref/pump.json"), "utf8")) as Idl;
const pumpParser = new EventParser(PUMP_PROGRAM_ID, new BorshCoder(pumpIdl));

const big = (v: unknown): bigint => (v instanceof BN ? BigInt(v.toString()) : typeof v === "bigint" ? v : BigInt(String(v)));
const key = (v: unknown): string => (v as PublicKey).toBase58();

export interface TradeRecord {
  signature: string; ixIndex: number; mint: string; side: "buy" | "sell"; btcAmount: bigint; tokenAmount: bigint; trader: string; slot: bigint; blockTime: number | null;
  venue: "curve" | "pool"; creatorFeeBtc: bigint; virtualQuoteReserves: bigint; virtualTokenReserves: bigint; realQuoteReserves: bigint; realTokenReserves: bigint; quoteMint: string;
}
export interface CreateRecord { signature: string; mint: string; name: string; symbol: string; uri: string; creator: string; user: string; bondingCurve: string; quoteMint: string; creatorFeeBps: bigint; tokenTotalSupply: bigint; virtualTokenReserves: bigint; realTokenReserves: bigint; virtualQuoteReserves: bigint; timestamp: bigint; slot: bigint }
export interface CompleteRecord { signature: string; mint: string; pool: string | null; timestamp: bigint; slot: bigint }
export interface CollectRecord { signature: string; creator: string; amount: bigint; quoteMint: string; slot: bigint }
export interface SettledRecord { signature: string; mint: string; amount: bigint; liquidity: bigint; buyback: bigint; operator: bigint; deployer: bigint; slot: bigint; blockTime: number | null }
export interface PayeePaidRecord { signature: string; mint: string; payee: string; amount: bigint; slot: bigint; blockTime: number | null }
export interface VaultOtherRecord { signature: string; name: string; data: Record<string, unknown>; slot: bigint; blockTime: number | null }
export interface HolderUpdate { mint: string; wallet: string; balance: bigint; slot: bigint }

export interface Decoded {
  trades: TradeRecord[]; creates: CreateRecord[]; completes: CompleteRecord[]; collects: CollectRecord[];
  settles: SettledRecord[]; payouts: PayeePaidRecord[]; vaultOther: VaultOtherRecord[]; holders: HolderUpdate[];
}

/** Decodes everything relevant in one transaction. Failed transactions yield nothing. */
export function decodeTx(tx: NormalizedTx): Decoded {
  const out: Decoded = { trades: [], creates: [], completes: [], collects: [], settles: [], payouts: [], vaultOther: [], holders: [] };
  if (tx.failed) return out;
  let ixIndex = 0;
  for (const e of pumpParser.parseLogs(tx.logMessages)) {
    const d = e.data as Record<string, unknown>;
    switch (e.name) {
      case "TradeEvent": {
        const quoteMint = key(d["quote_mint"]);
        const isSolQuote = quoteMint === PublicKey.default.toBase58();
        out.trades.push({
          signature: tx.signature, ixIndex: ixIndex++, mint: key(d["mint"]), side: d["is_buy"] ? "buy" : "sell",
          btcAmount: isSolQuote ? big(d["sol_amount"]) : big(d["quote_amount"]), tokenAmount: big(d["token_amount"]), trader: key(d["user"]),
          slot: tx.slot, blockTime: tx.blockTime, venue: "curve", creatorFeeBtc: big(d["creator_fee"]),
          virtualQuoteReserves: big(d["virtual_quote_reserves"]), virtualTokenReserves: big(d["virtual_token_reserves"]),
          realQuoteReserves: big(d["real_quote_reserves"]), realTokenReserves: big(d["real_token_reserves"]), quoteMint,
        });
        break;
      }
      case "CreateEvent":
        out.creates.push({ signature: tx.signature, mint: key(d["mint"]), name: String(d["name"]), symbol: String(d["symbol"]), uri: String(d["uri"]), creator: key(d["creator"]), user: key(d["user"]), bondingCurve: key(d["bonding_curve"]), quoteMint: key(d["quote_mint"]), creatorFeeBps: big(d["creator_fee_bps"]), tokenTotalSupply: big(d["token_total_supply"]), virtualTokenReserves: big(d["virtual_token_reserves"]), realTokenReserves: big(d["real_token_reserves"]), virtualQuoteReserves: big(d["virtual_quote_reserves"]), timestamp: big(d["timestamp"]), slot: tx.slot });
        break;
      case "CompleteEvent":
        out.completes.push({ signature: tx.signature, mint: key(d["mint"]), pool: null, timestamp: big(d["timestamp"]), slot: tx.slot });
        break;
      case "CompletePumpAmmMigrationEvent":
        out.completes.push({ signature: tx.signature, mint: key(d["mint"]), pool: key(d["pool"]), timestamp: big(d["timestamp"]), slot: tx.slot });
        break;
      case "CollectCreatorFeeEvent":
        out.collects.push({ signature: tx.signature, creator: key(d["creator"]), amount: big(d["creator_fee"]), quoteMint: key(d["quote_mint"]), slot: tx.slot });
        break;
      default:
        break;
    }
  }
  for (const e of parseVaultEvents(tx.logMessages)) {
    const d = e.data;
    if (e.name === "Settled") out.settles.push({ signature: tx.signature, mint: key(d["mint"]), amount: big(d["amount"]), liquidity: big(d["liquidity"]), buyback: big(d["buyback"]), operator: big(d["operator"]), deployer: big(d["deployer"]), slot: tx.slot, blockTime: tx.blockTime });
    else if (e.name === "PayeePaid") out.payouts.push({ signature: tx.signature, mint: key(d["mint"]), payee: key(d["payee"]), amount: big(d["amount"]), slot: tx.slot, blockTime: tx.blockTime });
    else out.vaultOther.push({ signature: tx.signature, name: e.name, data: d, slot: tx.slot, blockTime: tx.blockTime });
  }
  out.holders = holderUpdates(tx);
  return out;
}

/**
 * Post-transaction balances per (mint, owner) for every token account the tx touched. A wallet's balance for a mint
 * is the sum over its token accounts; accounts that appear only in `pre` (closed) count as 0.
 */
export function holderUpdates(tx: NormalizedTx, onlyMints?: Set<string>): HolderUpdate[] {
  const touched = new Map<string, { mint: string; owner: string }>();
  for (const b of [...tx.preTokenBalances, ...tx.postTokenBalances]) {
    if (!b.owner) continue;
    if (onlyMints && !onlyMints.has(b.mint)) continue;
    touched.set(`${b.mint}:${b.accountIndex}`, { mint: b.mint, owner: b.owner });
  }
  const sums = new Map<string, { mint: string; wallet: string; balance: bigint }>();
  for (const [k, { mint, owner }] of touched) {
    const idx = Number(k.split(":")[1]);
    const post = tx.postTokenBalances.find((b) => b.mint === mint && b.accountIndex === idx);
    const id = `${mint}:${owner}`;
    const cur = sums.get(id) ?? { mint, wallet: owner, balance: 0n };
    cur.balance += post?.amount ?? 0n;
    sums.set(id, cur);
  }
  return [...sums.values()].map((h) => ({ ...h, slot: tx.slot }));
}

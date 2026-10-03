"use client";
// Production SOL → BTC swap through Jupiter (V10), always via the API proxy (`/swap/quote`, `/swap/instructions`) so
// no Jupiter key reaches the browser. The swap is always its own transaction: with 3 lookup tables and 840–949 bytes
// it does not leave room to compose with a launch (V10), and SPEC allows "swap first, wait for finality".
import { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM } from "@satpad/sdk";
import { env } from "./env";
import { sendWithWallet, TxError, type Preview, type Rpc, type WalletLike } from "./tx";

export const MAX_TX_BYTES = 1232;
/** Refuse when the simulated overhead beyond the swapped SOL (fees + rent) exceeds this (STATUS M5 task 6). */
export const MAX_OVERHEAD_LAMPORTS = 3_000_000n; // 0.003 SOL
const ATA_RENT_LAMPORTS = 2_039_280n; // rent-exempt minimum of a token account (165 bytes)
const SIGNATURE_FEE_LAMPORTS = 5_000n;

export type SwapRpc = Rpc & Pick<Connection, "getAccountInfo" | "getAddressLookupTable">;

export interface JupiterQuote { inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; slippageBps: number; priceImpactPct: string; routePlan: { swapInfo: { label: string } }[] }
export interface JupiterIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
export interface JupiterInstructions { setupInstructions: JupiterIx[]; swapInstruction: JupiterIx; cleanupInstruction?: JupiterIx | null; otherInstructions?: JupiterIx[]; addressLookupTableAddresses: string[]; computeUnitLimit: number }

export async function fetchQuote(lamports: bigint, slippageBps = 50, fetchImpl: typeof fetch = fetch): Promise<JupiterQuote> {
  const r = await fetchImpl(`${env.apiUrl}/swap/quote?lamports=${lamports}&slippageBps=${slippageBps}`);
  if (!r.ok) throw new Error(`swap quote: ${(await r.json().catch(() => ({ error: r.status }))).error}`);
  return (await r.json()) as JupiterQuote;
}

export async function fetchInstructions(quoteResponse: JupiterQuote, user: PublicKey, fetchImpl: typeof fetch = fetch): Promise<JupiterInstructions> {
  const r = await fetchImpl(`${env.apiUrl}/swap/instructions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteResponse, userPublicKey: user.toBase58() }) });
  if (!r.ok) throw new Error(`swap build: ${(await r.json().catch(() => ({ error: r.status }))).error}`);
  return (await r.json()) as JupiterInstructions;
}

export function toInstruction(i: JupiterIx): TransactionInstruction {
  return new TransactionInstruction({ programId: new PublicKey(i.programId), keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(i.data, "base64") });
}

/** Jupiter's own compute-budget instructions are dropped: `sendWithWallet` sets the limit and the priority price. */
export function swapInstructions(si: JupiterInstructions): TransactionInstruction[] {
  return [...si.setupInstructions, si.swapInstruction, ...(si.cleanupInstruction ? [si.cleanupInstruction] : []), ...(si.otherInstructions ?? [])].map(toInstruction);
}

export async function loadTables(rpc: Pick<Connection, "getAddressLookupTable">, addresses: string[]): Promise<AddressLookupTableAccount[]> {
  const tables = await Promise.all(addresses.map(async (a) => (await rpc.getAddressLookupTable(new PublicKey(a))).value));
  return tables.map((t, i) => { if (!t) throw new Error(`lookup table ${addresses[i]} not found`); return t; });
}

/** Serialized size of the v0 transaction these instructions would make (with a placeholder blockhash). */
export function v0Size(payer: PublicKey, ixs: TransactionInstruction[], tables: AddressLookupTableAccount[]): number {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message(tables);
  return new VersionedTransaction(msg).serialize().length;
}

/** Lamports the user pays beyond the swapped amount: signature + priority fee + rent for a new wBTC account. */
export function overheadLamports(p: Pick<Preview, "unitsConsumed" | "priorityFeeMicroLamports">, needsQuoteAta: boolean): bigint {
  const priority = (BigInt(p.unitsConsumed) * p.priorityFeeMicroLamports + 999_999n) / 1_000_000n;
  return SIGNATURE_FEE_LAMPORTS + priority + (needsQuoteAta ? ATA_RENT_LAMPORTS : 0n);
}

export interface JupiterSwapDeps { fetchImpl?: typeof fetch; fetchFee?: () => Promise<bigint>; onPreview?: (p: Preview) => Promise<boolean> | boolean }

/** Quote → instructions → size check → simulate (sendWithWallet) → cost check → sign → send → confirm. */
export async function jupiterSwap(rpc: SwapRpc, wallet: WalletLike, lamports: bigint, onStatus?: (s: string) => void, deps: JupiterSwapDeps = {}): Promise<{ signature: string; sats: bigint; quote: JupiterQuote }> {
  const f = deps.fetchImpl ?? fetch;
  onStatus?.("quoting");
  const quote = await fetchQuote(lamports, 50, f);
  const si = await fetchInstructions(quote, wallet.publicKey, f);
  const ixs = swapInstructions(si);
  const tables = await loadTables(rpc, si.addressLookupTableAddresses);
  const size = v0Size(wallet.publicKey, ixs, tables) + 2 * 9; // + the compute-budget pair sendWithWallet prepends
  if (size > MAX_TX_BYTES) throw new TxError(`swap transaction too large (${size} > ${MAX_TX_BYTES} bytes)`);
  const quoteAta = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, wallet.publicKey, true, BTC_QUOTE_TOKEN_PROGRAM);
  const needsQuoteAta = (await rpc.getAccountInfo(quoteAta, "confirmed")) === null;
  const { signature } = await sendWithWallet(rpc, wallet, ixs, {
    tables, computeUnitLimit: Math.min(1_400_000, Math.ceil(si.computeUnitLimit * 1.1)),
    ...(deps.fetchFee && { fetchFee: deps.fetchFee }),
    onStatus,
    onPreview: async (p) => {
      const overhead = overheadLamports(p, needsQuoteAta);
      if (overhead > MAX_OVERHEAD_LAMPORTS) throw new TxError(`swap refused: fees and rent would cost ${overhead} lamports (> ${MAX_OVERHEAD_LAMPORTS})`);
      return deps.onPreview ? deps.onPreview(p) : true;
    },
  });
  return { signature, sats: BigInt(quote.outAmount), quote };
}

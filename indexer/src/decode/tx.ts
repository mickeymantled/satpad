// One transaction shape for every source. `getTransaction` (web3.js) and Helius raw webhooks (VERIFIED V8) differ in
// field placement; both normalize here so decoders see resolved pubkeys, logs and token balances.
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";

export interface TokenBalance { accountIndex: number; mint: string; owner: string | null; amount: bigint; decimals: number }
/** `data` is base58 in every source (RPC bytes are re-encoded) so decoders see one encoding. */
export interface NormalizedIx { programId: string; accounts: string[]; data: string }
/** Inner (CPI) instruction with the index of its top-level parent. Anchor `emit_cpi!` events live here, not in logs. */
export interface NormalizedInnerIx extends NormalizedIx { parentIndex: number }
export interface NormalizedTx {
  signature: string;
  slot: bigint;
  blockTime: number | null;
  failed: boolean;
  accountKeys: string[];
  logMessages: string[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  instructions: NormalizedIx[];
  innerInstructions: NormalizedInnerIx[];
}

type RawInner = { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[];
const inner = (groups: RawInner | null | undefined, keys: string[]): NormalizedInnerIx[] =>
  (groups ?? []).flatMap((g) => g.instructions.map((ix) => ({ parentIndex: g.index, programId: keys[ix.programIdIndex]!, accounts: ix.accounts.map((i) => keys[i]!), data: ix.data })));

type RawTokenBalance = { accountIndex: number; mint: string; owner?: string | null; uiTokenAmount: { amount: string; decimals: number } };
const tb = (b: RawTokenBalance): TokenBalance => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? null, amount: BigInt(b.uiTokenAmount.amount), decimals: b.uiTokenAmount.decimals });

/** From web3.js `getTransaction(sig, { maxSupportedTransactionVersion: 0 })`. */
export function fromRpc(signature: string, tx: VersionedTransactionResponse): NormalizedTx {
  const msg = tx.transaction.message;
  const loaded = tx.meta?.loadedAddresses;
  const keys = [...msg.staticAccountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])].map((k) => k.toBase58());
  return {
    signature,
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime ?? null,
    failed: tx.meta?.err !== null && tx.meta?.err !== undefined,
    accountKeys: keys,
    logMessages: tx.meta?.logMessages ?? [],
    preTokenBalances: (tx.meta?.preTokenBalances ?? []).map((b) => tb(b as RawTokenBalance)),
    postTokenBalances: (tx.meta?.postTokenBalances ?? []).map((b) => tb(b as RawTokenBalance)),
    instructions: msg.compiledInstructions.map((ix) => ({ programId: keys[ix.programIdIndex]!, accounts: ix.accountKeyIndexes.map((i) => keys[i]!), data: bs58.encode(ix.data) })),
    innerInstructions: inner(tx.meta?.innerInstructions as RawInner | null | undefined, keys),
  };
}

/** Shape of one element of a Helius raw webhook array (V8). Kept structural so tests can build it by hand. */
export interface HeliusRawTx {
  slot: number; blockTime?: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] } };
  meta: { err: unknown; logMessages?: string[]; preTokenBalances?: RawTokenBalance[]; postTokenBalances?: RawTokenBalance[]; loadedAddresses?: { writable?: string[]; readonly?: string[] }; innerInstructions?: RawInner };
}

export function fromHeliusRaw(tx: HeliusRawTx): NormalizedTx {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  return {
    signature: tx.transaction.signatures[0]!,
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime ?? null,
    failed: tx.meta.err !== null && tx.meta.err !== undefined,
    accountKeys: keys,
    logMessages: tx.meta.logMessages ?? [],
    preTokenBalances: (tx.meta.preTokenBalances ?? []).map(tb),
    postTokenBalances: (tx.meta.postTokenBalances ?? []).map(tb),
    instructions: tx.transaction.message.instructions.map((ix) => ({ programId: keys[ix.programIdIndex]!, accounts: ix.accounts.map((i) => keys[i]!), data: ix.data })),
    innerInstructions: inner(tx.meta.innerInstructions, keys),
  };
}

/**
 * Recorded fixture: `{ signature, ...getTransaction }` serialized with bigints as strings. web3.js serializes a legacy
 * `Message` as `{ accountKeys, instructions[{programIdIndex, accounts, data b58}] }` and a `MessageV0` as
 * `{ staticAccountKeys, compiledInstructions[{programIdIndex, accountKeyIndexes, data bytes}] }`.
 */
export function fromFixture(json: { signature: string } & Record<string, unknown>): NormalizedTx {
  type Legacy = { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] };
  type V0 = { staticAccountKeys: string[]; compiledInstructions: { programIdIndex: number; accountKeyIndexes: number[]; data: Record<string, number> | number[] }[] };
  const tx = json as unknown as { signature: string; slot: number; blockTime: number | null; meta: HeliusRawTx["meta"]; transaction: { message: Legacy | V0 } };
  const m = tx.transaction.message;
  const statics = "accountKeys" in m ? m.accountKeys : m.staticAccountKeys;
  const keys = [...statics, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])].map((k) => new PublicKey(k).toBase58());
  const instructions: NormalizedIx[] = "accountKeys" in m
    ? m.instructions.map((ix) => ({ programId: keys[ix.programIdIndex]!, accounts: ix.accounts.map((i) => keys[i]!), data: ix.data }))
    : m.compiledInstructions.map((ix) => ({ programId: keys[ix.programIdIndex]!, accounts: ix.accountKeyIndexes.map((i) => keys[i]!), data: bs58.encode(Uint8Array.from(Array.isArray(ix.data) ? ix.data : Object.values(ix.data))) }));
  return {
    signature: tx.signature,
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime ?? null,
    failed: tx.meta.err !== null && tx.meta.err !== undefined,
    accountKeys: keys,
    logMessages: tx.meta.logMessages ?? [],
    preTokenBalances: (tx.meta.preTokenBalances ?? []).map(tb),
    postTokenBalances: (tx.meta.postTokenBalances ?? []).map(tb),
    instructions,
    innerInstructions: inner(tx.meta.innerInstructions, keys),
  };
}

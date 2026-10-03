// Launch-transaction helpers. create_v2 + declare_coin + buy_v2 together exceed the 1232-byte legacy limit (~1770
// bytes), so launches use a v0 transaction with an address lookup table holding the accounts that are the same for
// every launch (pump globals, fee config, programs, quote mint, vault Config, fee recipients). Per-mint and per-user
// accounts stay inline, so a launch is still one atomic transaction (SPEC "Creation (one transaction)").
import {
  AddressLookupTableAccount, AddressLookupTableProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";

/**
 * Accounts shared by every launch: the intersection of the account sets of two launch instruction lists built for
 * different random mints/users. Signers are never included (lookup tables cannot hold them).
 */
export function staticAccounts(a: TransactionInstruction[], b: TransactionInstruction[]): PublicKey[] {
  const keysOf = (ixs: TransactionInstruction[]) => {
    const m = new Map<string, PublicKey>();
    for (const ix of ixs) {
      m.set(ix.programId.toBase58(), ix.programId);
      for (const k of ix.keys) if (!k.isSigner) m.set(k.pubkey.toBase58(), k.pubkey);
    }
    return m;
  };
  const ka = keysOf(a), kb = keysOf(b);
  return [...ka.entries()].filter(([s]) => kb.has(s)).map(([, k]) => k);
}

/** Builds a v0 transaction using `tables`. Throws if it still exceeds 1232 bytes. */
export function buildV0Transaction(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[], tables: AddressLookupTableAccount[]): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables);
  const tx = new VersionedTransaction(msg);
  let size: number;
  try {
    size = tx.serialize().length;
  } catch (e) {
    // web3.js overruns its 1232-byte buffer before we can measure
    throw new RangeError(`transaction exceeds 1232 bytes with the given lookup tables (${(e as Error).message})`);
  }
  if (size > 1232) throw new RangeError(`transaction is ${size} bytes (> 1232) even with lookup tables`);
  return tx;
}

/**
 * Creates and fills a lookup table (two transactions), then waits until it is usable (the extend slot must be
 * passed). Dev/fork helper and the one-time mainnet setup; production launches reuse the pinned address.
 */
export async function createLookupTable(conn: Connection, payer: Keypair, addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  const slot = await conn.getSlot("finalized");
  const [createIx, address] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < addresses.length; i += 20) chunks.push(addresses.slice(i, i + 20));
  const ixs = [createIx, ...chunks.map((c) => AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: payer.publicKey, payer: payer.publicKey, addresses: c }))];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([payer]);
  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  // A table is usable only after the slot it was extended in; wait for the next slot.
  const extendSlot = await conn.getSlot("confirmed");
  while ((await conn.getSlot("confirmed")) <= extendSlot) await new Promise((r) => setTimeout(r, 200));
  const table = (await conn.getAddressLookupTable(address, { commitment: "confirmed" })).value;
  if (!table) throw new Error("lookup table not found after creation");
  return table;
}

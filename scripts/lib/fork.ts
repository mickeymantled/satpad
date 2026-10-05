// Shared helpers for fork scripts: funded throwaway wallets, wBTC minting via the patched mint authority, a static
// launch lookup table, and a v0/legacy sender. Fork only — the wBTC authority keypair exists nowhere else.
import { readFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve(__dirname, "../..");
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, buildBuyV2, buildCreateV2, buildDeclareCoin, buildV0Transaction, coinFeePda, createLookupTable, defaultFeeRecipients, staticAccounts, type FeeRecipients, type PayeeChoice } from "@satpad/sdk";

export const RPC = process.env["LOCAL_RPC_URL"] ?? "http://127.0.0.1:8899";
/** Where seed.json / keeper.json / wbtc-authority.json live; a second stack (M6 on :8999) uses its own dir so the soak's files are never touched. */
export const KEYS_DIR = process.env["FORK_KEYS_DIR"] ?? "scripts/fork-keys";
export const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(BTC_QUOTE_MINT, owner, true, BTC_QUOTE_TOKEN_PROGRAM);

export function wbtcAuthority(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(ROOT, KEYS_DIR, "wbtc-authority.json"), "utf8"))));
}

export async function fundSol(conn: Connection, keys: PublicKey[], sol = 10): Promise<void> {
  for (const k of keys) await conn.confirmTransaction(await conn.requestAirdrop(k, sol * LAMPORTS_PER_SOL), "confirmed");
}

/** Creates the owner's wBTC ATA and mints `sats` into it (fork-only mint authority). */
export async function fundWbtc(conn: Connection, payer: Keypair, owner: PublicKey, sats: bigint): Promise<void> {
  const authority = wbtcAuthority();
  await send(conn, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(owner), owner, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM),
    createMintToInstruction(BTC_QUOTE_MINT, ata(owner), authority.publicKey, sats, [], BTC_QUOTE_TOKEN_PROGRAM),
  ], [payer, authority]);
}

export async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = [], cu = 600_000): Promise<string> {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs];
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  if (tables.length) {
    const tx = buildV0Transaction(signers[0]!.publicKey, blockhash, all, tables);
    tx.sign(signers);
    const sig = await conn.sendTransaction(tx);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  }
  const tx = new Transaction().add(...all);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = blockhash;
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
}

export interface LaunchCtx { conn: Connection; recipients: FeeRecipients; table: AddressLookupTableAccount; treasury: PublicKey }

/** Builds the one-time launch lookup table from two probe launches (DECISIONS D14). */
export async function launchContext(conn: Connection, payer: Keypair, treasury: PublicKey): Promise<LaunchCtx> {
  const recipients = defaultFeeRecipients(await new OnlinePumpSdk(conn).fetchGlobal());
  const probe = async () => {
    const m = Keypair.generate().publicKey, u = Keypair.generate().publicKey;
    return [
      await buildCreateV2({ mint: m, name: "p", symbol: "p", uri: "p", creator: coinFeePda(m)[0], user: u }),
      await buildDeclareCoin({ user: u, mint: m, treasury, payee: { kind: "me" } }),
      ...(await buildBuyV2({ user: u, mint: m, creator: coinFeePda(m)[0], recipients, tokenAmount: 1n, maxQuoteIn: 1n })),
    ];
  };
  const table = await createLookupTable(conn, payer, staticAccounts(await probe(), await probe()));
  return { conn, recipients, table, treasury };
}

/** create_v2 (creator = CoinFee) + declare_coin + first buy in one v0 transaction. Returns the mint. */
export async function launchCoin(ctx: LaunchCtx, user: Keypair, name: string, symbol: string, payee: PayeeChoice, firstBuyTokens: bigint, maxQuoteIn: bigint): Promise<{ mint: PublicKey; signature: string }> {
  const mint = Keypair.generate();
  const [coinFee] = coinFeePda(mint.publicKey);
  const ixs = [
    await buildCreateV2({ mint: mint.publicKey, name, symbol, uri: `https://satpad.invalid/${symbol}.json`, creator: coinFee, user: user.publicKey }),
    await buildDeclareCoin({ user: user.publicKey, mint: mint.publicKey, treasury: ctx.treasury, payee }),
    ...(await buildBuyV2({ user: user.publicKey, mint: mint.publicKey, creator: coinFee, recipients: ctx.recipients, tokenAmount: firstBuyTokens, maxQuoteIn })),
  ];
  const signature = await send(ctx.conn, ixs, [user, mint], [ctx.table]);
  return { mint: mint.publicKey, signature };
}

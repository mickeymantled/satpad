// DECISIONS D17 — fork-only faucet swap. Builds a transaction in which the user pays SOL to a sink and the fork's
// patched wBTC mint authority mints wBTC to the user's ATA at a fixed rate; the API co-signs with the authority and
// returns it base64 for the user to sign. Registered only when DEV_FAUCET_KEYPAIR is set; that key exists nowhere but
// the local fork, so this can never work against a real cluster.
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM } from "@satpad/sdk";
import type { FastifyInstance } from "fastify";

/** 1 SOL → 0.001 BTC (100,000 sats): a fixed dev rate, nothing to do with markets. */
export const FAUCET_SATS_PER_SOL = 100_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function faucetQuote(lamports: bigint): bigint {
  return (lamports * FAUCET_SATS_PER_SOL) / LAMPORTS_PER_SOL;
}

export async function buildFaucetSwap(conn: Pick<Connection, "getLatestBlockhash">, authority: Keypair, user: PublicKey, lamports: bigint): Promise<{ transaction: string; sats: bigint; blockhash: string; lastValidBlockHeight: number }> {
  if (lamports <= 0n || lamports > 100n * LAMPORTS_PER_SOL) throw new Error("amount must be 0 < lamports ≤ 100 SOL");
  const sats = faucetQuote(lamports);
  if (sats <= 0n) throw new Error("amount too small");
  const ata = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, user, true, BTC_QUOTE_TOKEN_PROGRAM);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: user, toPubkey: authority.publicKey, lamports: Number(lamports) }),
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM),
    createMintToInstruction(BTC_QUOTE_MINT, ata, authority.publicKey, sats, [], BTC_QUOTE_TOKEN_PROGRAM),
  );
  tx.feePayer = user;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(authority);
  return { transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), sats, blockhash, lastValidBlockHeight };
}

export function registerDevFaucet(app: FastifyInstance, conn: Connection, keypairPath: string): void {
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
  app.get("/dev/faucet", async () => ({ enabled: true, satsPerSol: FAUCET_SATS_PER_SOL.toString(), authority: authority.publicKey.toBase58() }));
  app.post("/dev/faucet", async (req, reply) => {
    const b = req.body as { wallet?: string; lamports?: string };
    if (!b?.wallet || !b.lamports || !/^\d+$/.test(b.lamports)) return reply.code(400).send({ error: "wallet and lamports (string) required" });
    try {
      const r = await buildFaucetSwap(conn, authority, new PublicKey(b.wallet), BigInt(b.lamports));
      return { ...r, sats: r.sats.toString() };
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
}

"use client";
// DECISIONS D17 — fork-only SOL → wBTC faucet. This module must never ship in a production bundle: the only import
// site is behind `process.env.NEXT_PUBLIC_DEV_SWAP === "1"`, which Next inlines at build time, and
// scripts/check-no-dev-swap.sh fails the build if the marker below is found in `.next` output.
import { Transaction } from "@solana/web3.js";
import { env } from "./env";
import type { WalletLike, Rpc } from "./tx";

export const DEV_SWAP_MARKER = "satpad-dev-swap-faucet";

export async function devFaucetInfo(): Promise<{ enabled: boolean; satsPerSol: string } | null> {
  try { const r = await fetch(`${env.apiUrl}/dev/faucet`); return r.ok ? ((await r.json()) as { enabled: boolean; satsPerSol: string }) : null; } catch { return null; }
}

/** Requests the co-signed faucet transaction, has the wallet sign it, sends and confirms. Returns the signature. */
export async function devFaucetSwap(rpc: Rpc, wallet: WalletLike, lamports: bigint, onStatus?: (s: string) => void): Promise<{ signature: string; sats: bigint }> {
  onStatus?.(`requesting ${DEV_SWAP_MARKER}`);
  const res = await fetch(`${env.apiUrl}/dev/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), lamports: lamports.toString() }) });
  if (!res.ok) throw new Error(`faucet: ${(await res.json().catch(() => ({ error: res.status }))).error}`);
  const j = (await res.json()) as { transaction: string; sats: string; blockhash: string; lastValidBlockHeight: number };
  const tx = Transaction.from(Buffer.from(j.transaction, "base64"));
  onStatus?.("awaiting signature");
  const signed = await wallet.signTransaction(tx);
  onStatus?.("sending");
  const signature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await rpc.confirmTransaction({ signature, blockhash: j.blockhash, lastValidBlockHeight: j.lastValidBlockHeight }, "confirmed");
  onStatus?.("confirmed");
  return { signature, sats: BigInt(j.sats) };
}

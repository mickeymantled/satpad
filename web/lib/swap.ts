"use client";
// SOL → BTC acquisition for users who hold only SOL (SPEC "SOL to BTC auto-swap"). Production routes through Jupiter
// (task 6b, V10); on the fork the D17 faucet is loaded behind a build-time constant so it is absent from production.
import type { Rpc, WalletLike } from "./tx";

export interface SwapResult { signature: string; sats: bigint }
export interface SolSwapper { kind: "jupiter" | "dev-faucet"; quote(lamports: bigint): Promise<bigint>; swap(rpc: Rpc, wallet: WalletLike, lamports: bigint, onStatus?: (s: string) => void): Promise<SwapResult> }

export async function loadSolSwapper(): Promise<SolSwapper | null> {
  if (process.env["NEXT_PUBLIC_DEV_SWAP"] === "1") {
    const dev = await import("./devSwap");
    const info = await dev.devFaucetInfo();
    if (!info?.enabled) return null;
    const satsPerSol = BigInt(info.satsPerSol);
    return { kind: "dev-faucet", quote: async (l) => (l * satsPerSol) / 1_000_000_000n, swap: (rpc, w, l, s) => dev.devFaucetSwap(rpc, w, l, s) };
  }
  return null; // Jupiter arrives in task 6b
}

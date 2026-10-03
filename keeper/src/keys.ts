// Hot keys loaded from JSON keypair files (Railway secrets mounted as files). Never logged, never serialized.
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export function loadKeypair(path: string): Keypair {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read keypair at ${path}: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) throw new Error(`keypair at ${path} is not a 64-byte JSON array`);
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}

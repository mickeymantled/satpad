// Shared plumbing for admin scripts (CLAUDE.md: every admin action is a script with a dry-run flag, no admin UI).
// Env: SOLANA_RPC_URL (default local fork), <ROLE>_KEYPAIR paths. Every script simulates first; --dry-run stops there.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { configPda, decodeConfig, parseVaultEvents, type Config } from "@satpad/sdk";
void configPda;

export const DRY_RUN = process.argv.includes("--dry-run");

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
export function requireArg(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`missing --${name}`);
  return v;
}
export const pubkeyArg = (name: string): PublicKey | undefined => (arg(name) ? new PublicKey(arg(name)!) : undefined);
export const bigintArg = (name: string): bigint | undefined => (arg(name) ? BigInt(arg(name)!) : undefined);

export function connection(): Connection {
  return new Connection(process.env["SOLANA_RPC_URL"] ?? "http://127.0.0.1:8899", "confirmed");
}

/** Loads a JSON keypair from the path in `envVar`. Never logs the secret. */
export function keypairFromEnv(envVar: string): Keypair {
  const path = process.env[envVar];
  if (!path) throw new Error(`${envVar} not set (path to a JSON keypair)`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export async function fetchConfig(conn: Connection): Promise<Config | null> {
  const info = await conn.getAccountInfo(configPda()[0], "confirmed");
  return info ? decodeConfig(info.data) : null;
}

/** Simulates, prints CU and events; sends only when not --dry-run. Returns the signature or "(dry-run)". */
export async function run(conn: Connection, label: string, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`${label}: simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
  console.log(`${label}: simulated ok (${sim.value.unitsConsumed} CU)`);
  for (const e of parseVaultEvents(sim.value.logs ?? [])) console.log(`  event ${e.name}:`, JSON.stringify(e.data, (_k, v) => (typeof v === "object" && v !== null && "toBase58" in v ? (v as PublicKey).toBase58() : typeof v === "object" && v !== null && "toString" in v && "words" in v ? String(v) : v)));
  if (DRY_RUN) {
    console.log(`${label}: dry-run, not sent`);
    return "(dry-run)";
  }
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log(`${label}: ${sig}`);
  return sig;
}

export function main(fn: () => Promise<void>): void {
  fn().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

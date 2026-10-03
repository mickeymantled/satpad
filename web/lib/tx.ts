// Client transaction pipeline (SPEC "Wallet and transactions"): every transaction is built from @satpad/sdk,
// simulated, shown instruction by instruction, then signed. Priority fee from the API; retry on blockhash expiry
// with a bumped fee (same bump curve as the keeper), max 5 attempts. No float money anywhere.
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, type Signer } from "@solana/web3.js";
import { bump, MAYHEM_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEES_PROGRAM_ID, PUMP_PROGRAM_ID, SATPAD_VAULT_PROGRAM_ID } from "@satpad/sdk";
import { env } from "./env";

export const PROGRAM_NAMES: Record<string, string> = {
  [PUMP_PROGRAM_ID.toBase58()]: "pump.fun",
  [PUMP_AMM_PROGRAM_ID.toBase58()]: "PumpSwap",
  [PUMP_FEES_PROGRAM_ID.toBase58()]: "pump.fun fees",
  [MAYHEM_PROGRAM_ID.toBase58()]: "pump.fun mayhem",
  [SATPAD_VAULT_PROGRAM_ID.toBase58()]: "satpad_vault",
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
};

/** Human description of one instruction for the preview list. */
export function describeInstruction(ix: TransactionInstruction): { program: string; programId: string; accounts: number; summary: string } {
  const programId = ix.programId.toBase58();
  const program = PROGRAM_NAMES[programId] ?? `${programId.slice(0, 4)}…${programId.slice(-4)}`;
  let summary = "";
  if (programId === PUMP_PROGRAM_ID.toBase58() || programId === SATPAD_VAULT_PROGRAM_ID.toBase58()) summary = anchorIxName(ix.data);
  else if (program === "System" && ix.data.length >= 4) summary = ix.data.readUInt32LE(0) === 2 ? `transfer ${ix.data.readBigUInt64LE(4)} lamports` : "system";
  else if (program === "Compute Budget") summary = ix.data[0] === 2 ? `limit ${ix.data.readUInt32LE(1)} CU` : ix.data[0] === 3 ? `price ${ix.data.readBigUInt64LE(1)} µ-lamports/CU` : "compute budget";
  else if (program === "Associated Token") summary = "create token account (idempotent)";
  else summary = program;
  return { program, programId, accounts: ix.keys.length, summary };
}
const KNOWN_DISCRIMINATORS: Record<string, string> = {};
function anchorIxName(data: Buffer): string {
  const key = data.subarray(0, 8).toString("hex");
  return KNOWN_DISCRIMINATORS[key] ?? "instruction";
}
/** Registers discriminator → name pairs (from the SDK IDLs) so previews can name pump/vault instructions. */
export function registerInstructionNames(entries: { discriminator: number[]; name: string }[]): void {
  for (const e of entries) KNOWN_DISCRIMINATORS[Buffer.from(e.discriminator).toString("hex")] = e.name;
}

export interface WalletLike { publicKey: PublicKey; signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> }
export type Rpc = Pick<Connection, "getLatestBlockhash" | "simulateTransaction" | "sendRawTransaction" | "confirmTransaction">;

export interface Preview { instructions: ReturnType<typeof describeInstruction>[]; unitsConsumed: number; priorityFeeMicroLamports: bigint; sizeBytes: number; logs: string[] }
export interface SendOptions { computeUnitLimit?: number; maxAttempts?: number; tables?: AddressLookupTableAccount[]; /** Extra keypairs that must sign after the wallet (a launch's new mint keypair). */ extraSigners?: Signer[]; onPreview?: (p: Preview) => Promise<boolean> | boolean; onStatus?: (s: string) => void; fetchFee?: () => Promise<bigint> }

export async function fetchPriorityFee(): Promise<bigint> {
  try { const r = await fetch(`${env.apiUrl}/fees/priority`); const j = (await r.json()) as { microLamportsPerCu: string }; return BigInt(j.microLamportsPerCu); } catch { return 1_000n; }
}

export class TxError extends Error { constructor(msg: string, readonly logs: string[] = []) { super(msg); } }
const EXPIRED = /block ?height exceeded|blockhash not found|expired/i;

/** Build → simulate (preview) → sign → send → confirm. Returns the signature; throws TxError with logs. */
export async function sendWithWallet(rpc: Rpc, wallet: WalletLike, ixs: TransactionInstruction[], opts: SendOptions = {}): Promise<{ signature: string; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 5, cuLimit = opts.computeUnitLimit ?? 600_000;
  const baseFee = await (opts.fetchFee ?? fetchPriorityFee)();
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fee = bump(baseFee, attempt);
    const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(fee) }), ...ixs];
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash("confirmed");
    let tx: Transaction | VersionedTransaction;
    if (opts.tables?.length) tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message(opts.tables));
    else { const t = new Transaction().add(...all); t.feePayer = wallet.publicKey; t.recentBlockhash = blockhash; tx = t; }
    try {
      if (attempt === 1) {
        opts.onStatus?.("simulating");
        const sim = tx instanceof VersionedTransaction ? await rpc.simulateTransaction(tx, { sigVerify: false }) : await rpc.simulateTransaction(tx);
        if (sim.value.err) throw new TxError(`Simulation failed: ${JSON.stringify(sim.value.err)}`, sim.value.logs ?? []);
        const size = tx instanceof VersionedTransaction ? tx.serialize().length : tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
        const preview: Preview = { instructions: all.map(describeInstruction), unitsConsumed: sim.value.unitsConsumed ?? 0, priorityFeeMicroLamports: fee, sizeBytes: size, logs: sim.value.logs ?? [] };
        if (opts.onPreview && !(await opts.onPreview(preview))) throw new TxError("Cancelled");
      }
      opts.onStatus?.("awaiting signature");
      const signed = await wallet.signTransaction(tx);
      if (opts.extraSigners?.length) { if (signed instanceof VersionedTransaction) signed.sign(opts.extraSigners); else signed.partialSign(...opts.extraSigners); }
      opts.onStatus?.("sending");
      const signature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 });
      opts.onStatus?.("confirming");
      const conf = await rpc.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new TxError(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
      opts.onStatus?.("confirmed");
      return { signature, attempts: attempt };
    } catch (e) {
      lastErr = e as Error;
      const retryable = !(e instanceof TxError) && (EXPIRED.test(String((e as Error).message)) || EXPIRED.test((e as Error).name ?? ""));
      if (!retryable || attempt === maxAttempts) throw lastErr;
      opts.onStatus?.(`expired, retrying (${attempt + 1}/${maxAttempts})`);
    }
  }
  throw lastErr ?? new TxError("unreachable");
}

// Transaction sending with the SPEC rules: simulate first, priority fee from the provider, retry with a bumped fee on
// blockhash expiry up to maxAttempts (≤ 5), and a ledger row written before send and after confirmation.
import { ComputeBudgetProgram, Connection, Keypair, Transaction, TransactionInstruction, type SendOptions } from "@solana/web3.js";
import type { PriorityFeeProvider } from "./fees";
import type { LedgerEntry, LedgerStore } from "./ledger";
import type { Logger } from "./log";

/** The slice of Connection the sender uses — mockable in tests. */
export type Rpc = Pick<Connection, "getLatestBlockhash" | "simulateTransaction" | "sendRawTransaction" | "confirmTransaction">;

export interface SenderOptions { computeUnitLimit: number; maxAttempts: number; log: Logger; sendOptions?: SendOptions }

export class SendError extends Error {
  constructor(msg: string, readonly logs: string[] = [], readonly retryable = false) { super(msg); }
}

export interface SendResult { signature: string; slot: bigint; attempts: number; ledgerId: bigint }

const EXPIRED = /block ?height exceeded|blockhash not found|expired|TransactionExpiredBlockheightExceededError/i;
/** The exact same bytes were processed already (arg-less instruction + repeated blockhash): rebuild with a new blockhash. */
const ALREADY = /AlreadyProcessed/;

export class Sender {
  constructor(private readonly rpc: Rpc, private readonly fees: PriorityFeeProvider, private readonly store: LedgerStore, private readonly opts: SenderOptions) {}

  /**
   * Builds, simulates, sends and confirms. Simulation failures are not retried (the state is wrong, not the network);
   * blockhash expiry is retried with a bumped priority fee. Every outcome is in the ledger.
   */
  async send(entry: LedgerEntry, ixs: TransactionInstruction[], signers: Keypair[]): Promise<SendResult> {
    if (signers.length === 0) throw new Error("no signers");
    const id = await this.store.begin(entry);
    const log = this.opts.log.child({ ledgerId: id, type: entry.type, mint: entry.mint });
    let lastErr: Error | undefined;
    let lastBlockhash: string | null = null;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      try {
        const tx = new Transaction();
        const fee = await this.fees.estimate(tx, attempt);
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.opts.computeUnitLimit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(fee) }), ...ixs);
        tx.feePayer = signers[0]!.publicKey;
        let { blockhash, lastValidBlockHeight } = await this.rpc.getLatestBlockhash("confirmed");
        // After an AlreadyProcessed, the same blockhash would reproduce the same signature: wait for a new one.
        for (let i = 0; lastBlockhash !== null && blockhash === lastBlockhash && i < 20; i++) {
          await new Promise((r) => setTimeout(r, 250));
          ({ blockhash, lastValidBlockHeight } = await this.rpc.getLatestBlockhash("confirmed"));
        }
        lastBlockhash = blockhash;
        tx.recentBlockhash = blockhash;
        tx.sign(...signers);
        if (attempt === 1 || lastErr instanceof SendError && lastErr.retryable && ALREADY.test(lastErr.message)) {
          const sim = await this.rpc.simulateTransaction(tx);
          if (sim.value.err) {
            const msg = JSON.stringify(sim.value.err);
            throw new SendError(`simulation failed: ${msg}`, sim.value.logs ?? [], ALREADY.test(msg));
          }
        }
        const signature = await this.rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0, ...this.opts.sendOptions });
        await this.store.markSent(id, signature, attempt);
        log.info("sent", { signature, attempt, fee });
        const conf = await this.rpc.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (conf.value.err) throw new SendError(`confirmed with error: ${JSON.stringify(conf.value.err)}`, [], false);
        const slot = BigInt(conf.context.slot);
        await this.store.markConfirmed(id, slot);
        log.info("confirmed", { signature, slot, attempts: attempt });
        return { signature, slot, attempts: attempt, ledgerId: id };
      } catch (e) {
        lastErr = e as Error;
        const retryable = e instanceof SendError ? e.retryable : EXPIRED.test(String((e as Error).message ?? e)) || EXPIRED.test((e as Error).name ?? "");
        if (!retryable || attempt === this.opts.maxAttempts) {
          await this.store.markFailed(id, lastErr.message, attempt);
          log.error("failed", { attempt, error: lastErr.message, retryable });
          throw lastErr;
        }
        log.warn("retrying after expiry", { attempt, error: lastErr.message });
      }
    }
    throw lastErr ?? new Error("unreachable");
  }
}

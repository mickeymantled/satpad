import type { NormalizedTx } from "../decode";

/** Where sources hand transactions. The processor (task 4) implements it; tests use a recording sink. */
export interface TxSink {
  /** Returns false when the signature was already processed (dedupe across sources). */
  handle(tx: NormalizedTx): Promise<boolean>;
}

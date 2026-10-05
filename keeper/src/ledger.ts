// Ledger writes around every transaction (SPEC "Keeper service → Rules"): a row exists with status `built` before
// anything is sent, is marked `sent` with the signature, then `confirmed` or `failed`. The store is an interface so
// the retry logic is unit-tested with an in-memory implementation and the keeper uses Postgres.
import { eq, sql } from "drizzle-orm";
import { ledger, type Db } from "@satpad/db";

export type LedgerType = (typeof ledger.$inferInsert)["type"];
export interface LedgerEntry { type: LedgerType; mint?: string; actor: string; amounts: Record<string, string> }

export interface LedgerStore {
  begin(e: LedgerEntry): Promise<bigint>;
  markSent(id: bigint, signature: string, attempt: number): Promise<void>;
  markConfirmed(id: bigint, slot: bigint): Promise<void>;
  markFailed(id: bigint, error: string, attempts: number): Promise<void>;
}

export class PgLedger implements LedgerStore {
  constructor(private readonly db: Db) {}
  /** Sum of the buyback share of confirmed settles in the last `hours` (D22 idle-balance alert). */
  async buybackInflow(hours = 1): Promise<bigint> {
    const [r] = await this.db.select({ v: sql<string>`coalesce(sum((${ledger.amounts}->>'buyback')::numeric), 0)` }).from(ledger)
      .where(sql`${ledger.type} = 'settle' and ${ledger.status} = 'confirmed' and ${ledger.confirmedAt} > now() - make_interval(hours => ${hours})`);
    return BigInt(r?.v ?? "0");
  }
  async begin(e: LedgerEntry): Promise<bigint> {
    const [row] = await this.db.insert(ledger).values({ type: e.type, mint: e.mint ?? null, actor: e.actor, amounts: e.amounts, status: "built" }).returning({ id: ledger.id });
    return row!.id;
  }
  async markSent(id: bigint, signature: string, attempt: number): Promise<void> {
    await this.db.update(ledger).set({ status: "sent", signature, attempts: attempt }).where(eq(ledger.id, id));
  }
  async markConfirmed(id: bigint, slot: bigint): Promise<void> {
    await this.db.update(ledger).set({ status: "confirmed", slot, confirmedAt: new Date() }).where(eq(ledger.id, id));
  }
  async markFailed(id: bigint, error: string, attempts: number): Promise<void> {
    await this.db.update(ledger).set({ status: "failed", error: error.slice(0, 2000), attempts }).where(eq(ledger.id, id));
  }
}

export interface MemoryRow extends LedgerEntry { id: bigint; status: "built" | "sent" | "confirmed" | "failed"; signature?: string; attempts: number; slot?: bigint; error?: string }
export class MemoryLedger implements LedgerStore {
  rows: MemoryRow[] = [];
  private next = 1n;
  async begin(e: LedgerEntry): Promise<bigint> { const id = this.next++; this.rows.push({ ...e, id, status: "built", attempts: 0 }); return id; }
  private row(id: bigint): MemoryRow { const r = this.rows.find((x) => x.id === id); if (!r) throw new Error(`ledger row ${id} missing`); return r; }
  async markSent(id: bigint, signature: string, attempt: number): Promise<void> { Object.assign(this.row(id), { status: "sent", signature, attempts: attempt }); }
  async markConfirmed(id: bigint, slot: bigint): Promise<void> { Object.assign(this.row(id), { status: "confirmed", slot }); }
  async markFailed(id: bigint, error: string, attempts: number): Promise<void> { Object.assign(this.row(id), { status: "failed", error, attempts }); }
}

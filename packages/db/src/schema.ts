// Postgres schema shared by the keeper (writer of `ledger`) and the indexer/API (M4). SPEC "Tables". Amounts are
// base-unit strings (numeric(20,0)) — never floats. Only the tables M3 needs exist yet; M4 adds trades/holders/fees.
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const stage = pgEnum("stage", ["dust", "mining", "block"]);
export const payeeMode = pgEnum("payee_mode", ["wallet", "holders"]);
export const ledgerStatus = pgEnum("ledger_status", ["built", "sent", "confirmed", "failed"]);
export const ledgerType = pgEnum("ledger_type", [
  "collect_creator_fee", "settle", "pay_payee", "release_rewards", "rewards_transfer", "draw_lp", "lp_deposit", "buyback",
  "set_split", "set_wallets", "set_pause", "set_coin_pause", "recover", "set_lp", "initialize",
]);

/** Registered coins (SPEC `coins`). The keeper fills the registry subset; the indexer fills the rest. */
export const coins = pgTable("coins", {
  mint: text("mint").primaryKey(),
  name: text("name"),
  symbol: text("symbol"),
  uri: text("uri"),
  deployer: text("deployer").notNull(),
  payee: text("payee").notNull(),
  payeeMode: payeeMode("payee_mode").notNull(),
  treasuryOnly: boolean("treasury_only").notNull().default(false),
  stage: stage("stage").notNull().default("dust"),
  curveProgressBps: integer("curve_progress_bps").notNull().default(0),
  bondingCurve: text("bonding_curve").notNull(),
  pool: text("pool"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  graduatedAt: timestamp("graduated_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false),
  /** Slot at which the keeper last read this row's on-chain state. */
  updatedSlot: bigint("updated_slot", { mode: "bigint" }).notNull().default(sql`0`),
});

/**
 * Every keeper and admin transaction (SPEC `ledger`). Written with status `built` before send, updated to `sent`,
 * then `confirmed`/`failed` — so a crash mid-send leaves an auditable row. The transparency page reads this.
 */
export const ledger = pgTable("ledger", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  signature: text("signature"),
  type: ledgerType("type").notNull(),
  mint: text("mint"),
  actor: text("actor").notNull(),
  /** Base-unit amounts keyed by name, e.g. {"fee":"10","liquidity":"3"} — strings, never numbers. */
  amounts: jsonb("amounts").$type<Record<string, string>>().notNull().default({}),
  status: ledgerStatus("status").notNull().default("built"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  slot: bigint("slot", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => [index("ledger_mint_idx").on(t.mint), index("ledger_type_idx").on(t.type), index("ledger_sig_idx").on(t.signature)]);

/** Last successful tick per keeper loop, for /healthz and the status line on /docs. */
export const keeperHealth = pgTable("keeper_health", {
  loop: text("loop").notNull(),
  instance: text("instance").notNull(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }).notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
}, (t) => [primaryKey({ columns: [t.loop, t.instance] })]);

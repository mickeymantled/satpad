// Postgres schema shared by the keeper (writer of `ledger`) and the indexer/API (M4). SPEC "Tables". Amounts are
// base-unit strings (numeric(20,0)) — never floats. Only the tables M3 needs exist yet; M4 adds trades/holders/fees.
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const stage = pgEnum("stage", ["dust", "mining", "block"]);
export const payeeMode = pgEnum("payee_mode", ["wallet", "holders"]);
export const ledgerStatus = pgEnum("ledger_status", ["built", "sent", "confirmed", "failed"]);
export const tradeSide = pgEnum("trade_side", ["buy", "sell"]);
export const venue = pgEnum("venue", ["curve", "pool"]);
export const bridgeDirection = pgEnum("bridge_direction", ["in", "out"]);
export const bridgeStatus = pgEnum("bridge_status", ["quoted", "pending_deposit", "processing", "success", "refunded", "failed", "held"]);
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
  // ---- indexer-owned (SPEC `coins` + derived fields) ----
  buys: integer("buys").notNull().default(0),
  sells: integer("sells").notNull().default(0),
  /** Lifetime BTC traded, base units. */
  volumeBtc: numeric("volume_btc", { precision: 30, scale: 0 }).notNull().default("0"),
  /** Latest curve state for price/mcap; base units. */
  virtualQuoteReserves: numeric("virtual_quote_reserves", { precision: 30, scale: 0 }),
  virtualTokenReserves: numeric("virtual_token_reserves", { precision: 30, scale: 0 }),
  realTokenReserves: numeric("real_token_reserves", { precision: 30, scale: 0 }),
  tokenTotalSupply: numeric("token_total_supply", { precision: 30, scale: 0 }),
  /** BTC paid to holders (rewards runs), base units. */
  btcPaidToHolders: numeric("btc_paid_to_holders", { precision: 30, scale: 0 }).notNull().default("0"),
  holderCount: integer("holder_count").notNull().default(0),
  lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
  indexedSlot: bigint("indexed_slot", { mode: "bigint" }).notNull().default(sql`0`),
});

/** Every pump.fun / PumpSwap trade on a registered coin (SPEC `trades`). */
export const trades = pgTable("trades", {
  signature: text("signature").notNull(),
  /** One tx can carry several trades (one per instruction); index within the tx. */
  ixIndex: integer("ix_index").notNull().default(0),
  mint: text("mint").notNull(),
  side: tradeSide("side").notNull(),
  btcAmount: numeric("btc_amount", { precision: 30, scale: 0 }).notNull(),
  tokenAmount: numeric("token_amount", { precision: 30, scale: 0 }).notNull(),
  /** BTC base units per whole token, scaled by 1e12 to keep integer math (see sdk `priceScaled`). */
  priceBtcScaled: numeric("price_btc_scaled", { precision: 40, scale: 0 }).notNull(),
  trader: text("trader").notNull(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  blockTime: timestamp("block_time", { withTimezone: true }),
  venue: venue("venue").notNull(),
  /** Creator fee paid on this trade (base units) when the event exposes it. */
  creatorFeeBtc: numeric("creator_fee_btc", { precision: 30, scale: 0 }),
}, (t) => [primaryKey({ columns: [t.signature, t.ixIndex] }), index("trades_mint_slot_idx").on(t.mint, t.slot), index("trades_trader_idx").on(t.trader), index("trades_time_idx").on(t.blockTime)]);

/** Materialized token balances per wallet (SPEC `holders`), from post-balance deltas. */
export const holders = pgTable("holders", {
  mint: text("mint").notNull(),
  wallet: text("wallet").notNull(),
  balance: numeric("balance", { precision: 30, scale: 0 }).notNull(),
  updatedSlot: bigint("updated_slot", { mode: "bigint" }).notNull(),
}, (t) => [primaryKey({ columns: [t.mint, t.wallet] }), index("holders_mint_balance_idx").on(t.mint, t.balance)]);

/** One row per vault `Settled` event (SPEC `fees`). */
export const fees = pgTable("fees", {
  signature: text("signature").primaryKey(),
  mint: text("mint").notNull(),
  creatorFeeBtc: numeric("creator_fee_btc", { precision: 30, scale: 0 }).notNull(),
  liquidity: numeric("liquidity", { precision: 30, scale: 0 }).notNull(),
  buyback: numeric("buyback", { precision: 30, scale: 0 }).notNull(),
  operator: numeric("operator", { precision: 30, scale: 0 }).notNull(),
  deployer: numeric("deployer", { precision: 30, scale: 0 }).notNull(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, (t) => [index("fees_mint_idx").on(t.mint)]);

/** Holder-rewards runs (SPEC `rewards_runs`): the on-chain record plus the keeper's published snapshot. */
export const rewardsRuns = pgTable("rewards_runs", {
  mint: text("mint").notNull(),
  runIndex: bigint("run_index", { mode: "bigint" }).notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  snapshotUrl: text("snapshot_url"),
  potBtc: numeric("pot_btc", { precision: 30, scale: 0 }).notNull(),
  holdersPaid: integer("holders_paid").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  transferSignatures: jsonb("transfer_signatures").$type<string[]>().notNull().default([]),
  releaseSignature: text("release_signature").notNull(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.mint, t.runIndex] })]);

/** LP deposit runs (SPEC `lp_runs`): draw + swap + deposit + burn, one transaction. */
export const lpRuns = pgTable("lp_runs", {
  signature: text("signature").primaryKey(),
  btcDrawn: numeric("btc_drawn", { precision: 30, scale: 0 }).notNull(),
  satpadBought: numeric("satpad_bought", { precision: 30, scale: 0 }).notNull().default("0"),
  lpMinted: numeric("lp_minted", { precision: 30, scale: 0 }).notNull().default("0"),
  lpBurned: numeric("lp_burned", { precision: 30, scale: 0 }).notNull().default("0"),
  poolReservesAfter: jsonb("pool_reserves_after").$type<{ base: string; quote: string }>(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  ranAt: timestamp("ran_at", { withTimezone: true }),
});

/** NEAR Intents transfers (SPEC `bridge_transfers`). No Bitcoin addresses stored beyond what 1Click returns. */
export const bridgeTransfers = pgTable("bridge_transfers", {
  id: text("id").primaryKey(),
  direction: bridgeDirection("direction").notNull(),
  solanaWallet: text("solana_wallet").notNull(),
  intentsDepositAddress: text("intents_deposit_address"),
  amount: numeric("amount", { precision: 30, scale: 0 }).notNull(),
  status: bridgeStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bridge_wallet_idx").on(t.solanaWallet)]);

/** Per-address ingestion cursor for the polling source (last processed signature + slot). */
export const indexerCursor = pgTable("indexer_cursor", {
  address: text("address").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: bigint("last_slot", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Processed transactions: makes every source idempotent (webhook + polling may overlap). */
export const processedTx = pgTable("processed_tx", {
  signature: text("signature").primaryKey(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("processed_tx_sig_idx").on(t.signature)]);

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

/** D18 fallback metadata backend (and the fork path): `POST /metadata` stores the JSON + image, served at `/m/:id.json|png`. */
export const coinMetadata = pgTable("coin_metadata", {
  id: text("id").primaryKey(),
  mint: text("mint"),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  description: text("description").notNull(),
  imageMime: text("image_mime").notNull(),
  imageBase64: text("image_base64").notNull(),
  twitter: text("twitter"),
  telegram: text("telegram"),
  website: text("website"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

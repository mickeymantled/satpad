# indexer — milestone 4 (in progress)

## Built
- Task 1: `packages/db` migration `0001_m4_indexer_tables`: `trades` (pk signature+ix_index, venue, price scaled 1e12),
  `holders` (pk mint+wallet, balance numeric), `fees` (one per `Settled`), `rewards_runs`, `lp_runs`, `bridge_transfers`,
  `indexer_cursor` (per-address polling cursor), `processed_tx` (idempotency across sources); `coins` gains indexer-owned
  columns (buys/sells/volume, curve reserves, holder_count, btc_paid_to_holders, last_trade_at, indexed_slot).
  Amounts are `numeric(30,0)` strings — never floats.

## Deferred
- Tasks 2–8 (STATUS.md).

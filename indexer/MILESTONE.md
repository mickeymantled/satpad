# indexer — milestone 4 (in progress)

## Built
- Task 1: `packages/db` migration `0001_m4_indexer_tables`: `trades` (pk signature+ix_index, venue, price scaled 1e12),
  `holders` (pk mint+wallet, balance numeric), `fees` (one per `Settled`), `rewards_runs`, `lp_runs`, `bridge_transfers`,
  `indexer_cursor` (per-address polling cursor), `processed_tx` (idempotency across sources); `coins` gains indexer-owned
  columns (buys/sells/volume, curve reserves, holder_count, btc_paid_to_holders, last_trade_at, indexed_slot).
  Amounts are `numeric(30,0)` strings — never floats.

- Task 2: `src/decode/tx.ts` — `NormalizedTx` from web3 `getTransaction` (`fromRpc`), Helius raw webhook elements
  (`fromHeliusRaw`, V8 shape) and recorded fixtures (`fromFixture`, legacy + v0 message shapes); instruction data is
  base58 in every source. `src/decode/events.ts` — `decodeTx`: pump `TradeEvent` (wBTC `quote_amount` vs SOL
  `sol_amount`, reserves, creator fee), `CreateEvent`, `CompleteEvent`/`CompletePumpAmmMigrationEvent`,
  `CollectCreatorFeeEvent`; vault `Settled`/`PayeePaid` (+ other vault events kept raw); `holderUpdates` sums post
  balances per (mint, owner), zeroes closed accounts. Failed txs decode to nothing.
- Tests (8) on `test/fixtures/{buy_v2,sell_v2,settle,pay_payee,collect_creator_fee_v2}.json` recorded from the soak
  fork: trade sides/venue/quote mint/reserves/holder balance, Settled amounts == SDK `splitFee`, PayeePaid, collect,
  failed-tx no-op, Helius-raw ≡ RPC shape, multi-account holder sums.

## Deferred
- `launch_v0.json` fixture (needs a fresh fork; test validator history is ~60 slots).
- Tasks 2–8 (STATUS.md).

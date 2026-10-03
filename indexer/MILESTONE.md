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

- Task 3: `src/ratelimit.ts` `TokenBucket` (req/s + burst, per-minute counters, waited-ms); `src/sources/polling.ts`
  `PollingSource` (per-address cursor via `indexer_cursor` or memory; pages newest→cursor with `until`, processes
  oldest→newest, cursor advanced per tx so a crash resumes mid-page; skips errored sigs; failing address isolated);
  `src/sources/webhook.ts` `WebhookQueue` + `startWebhookServer` (V8: `Authorization` == authHeader else 403, JSON
  array else 400, 200 acked synchronously, async drain shared by callers, malformed elements counted and ignored).
  `TxSink.handle(tx) → boolean` is the dedupe contract the processor implements. Tests (6).

- Task 4: `src/process.ts` `Processor` (implements `TxSink`): one DB transaction per signature with `processed_tx` as
  the idempotency gate; `Declared` registers the coin (name/symbol/uri from the same tx's `CreateEvent`); trades only
  for registered mints → `trades` (price scaled 1e12), `coins` counters/reserves/`last_trade_at`, stage dust→mining at
  10 buys (block sticky); holders upserted from post balances with a slot guard, bonding curve and pool excluded,
  `holder_count` = positive balances; `CompleteEvent` → block + pool + graduated_at; `Settled` → `fees`;
  `PayeeRedirected`/`HolderRewardsSet`/`Paused`/`RewardsReleased`/`LpDrawn` applied; `pg_notify('satpad_live')` on trades
  and registrations. Tests (4, Postgres): unregistered ignored → registered indexed, duplicate signature rejected,
  holders/holder_count, sell + stage flip at 10 buys, fees idempotent.

## Deferred
- `launch_v0.json` fixture (needs a fresh fork; test validator history is ~60 slots).
- Tasks 2–8 (STATUS.md).

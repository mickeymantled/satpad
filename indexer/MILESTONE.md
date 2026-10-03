# indexer — milestone 4: Indexer and API

**Status: closed 2026-10-03 pending human review.** DoD: `/coins` and `/ledger` match on-chain state for the fork set — **met** (`pnpm fork:api-check`: 10 coins, reserves/progress/stage exact, 20 holder balances exact vs a fresh getProgramAccounts sweep, ledger entries within the validator's retained window; 0 problems).

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

- Task 5: `src/config.ts`, `src/main.ts` — each pass polls the vault program first (registrations) then every registered
  curve/pool through the `TokenBucket` (`RPC_RATE_PER_SECOND`, default 4; `RPC_BURST` 8); `/healthz` (503 when stale or
  failing); `keeper_health` row `indexer-poll`; a `rpc rate` log line every minute (total, last-minute, waited-ms) so a
  soak summary can show the footprint; optional Helius webhook receiver; `--once`. `Dockerfile`, `railway.toml`.
  First run against the live soak fork (2026-10-03 ~12:35 UTC): pass 1 = 65 txs / 76 RPC calls / 14.9 s limiter wait,
  steady state ~27 calls per 5 s pass; 10 coins, trades/holders/fees populated; the soak's rolling reconciler stayed clean.

- Task 8: `scripts/fork-api-check.ts` (`pnpm fork:api-check`) — waits until each coin's newest curve tx is indexed
  (≤ 30 s), then diffs the API against the chain: curve reserves/progress/stage, ledger entries (retained window) vs
  vault events, holders table vs a `getProgramAccounts` sweep (human note), `holderCount`. Exit 1 on drift. Added to
  `keeper-reconcile.yml` after a `--once` indexer run. Findings on the live fork: `getSignaturesForAddress(until)`
  fails once the cursor's signature is purged from a short-history node → slot-floor fallback (`polling.ts`); launches
  that predate the indexer are invisible to balance deltas → periodic holders sweep (`sweep.ts`,
  `HOLDER_SWEEP_INTERVAL_MS`, default 10 min, 1 RPC call per coin).

## Deferred
- `launch_v0.json` fixture (needs a fresh fork; test validator history is ~60 slots).
- Helius webhook source is implemented but only unit-tested (no Helius account on the fork); first live use is M10 staging.
- PumpSwap (pool) trade decoding — M6 when a pool exists on the fork.
- Tasks 2–8 (STATUS.md).

## Addendum 2026-10-03 (M5 task 7)
- `NormalizedTx.innerInstructions` (RPC, Helius raw and fixture normalizers) and `pumpEvents()`: pump.fun events are
  read from `emit_cpi` self-CPI inner instructions first, then from logs, de-duplicated. Reason: a launch
  (create_v2 + declare_coin + buy_v2 in one v0 transaction) overflows the runtime's log limit and ends with
  "Log truncated", which lost the first buy's `TradeEvent`. Fixture `launch_v0.json` + decoder test.

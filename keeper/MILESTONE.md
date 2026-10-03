# keeper — milestone 3 (in progress)

## Built
- Task 1: `packages/db` — Drizzle + Postgres 16. Tables `coins` (registry subset), `ledger` (every keeper/admin tx:
  type enum, mint, actor, base-unit string amounts in jsonb, status built→sent→confirmed/failed, attempts, slot),
  `keeper_health` (last ok tick per loop/instance). `connect()`, `runMigrations()`, `pnpm db:generate` / `db:migrate`.
  Tests create a throwaway database per run and skip with instructions when Postgres is unreachable.

- Task 2a: `src/config.ts` (env → `KeeperConfig`, bigint thresholds, ≤ 5 attempts enforced, `describeConfig` redacts
  API keys and DB passwords), `src/keys.ts` (64-byte JSON keypairs, never logged), `src/log.ts` (JSON lines, bigint-safe,
  no library), `src/fees.ts` (`PriorityFeeProvider`; `FixedFeeProvider`; `LiveFeeProvider`: Helius `getPriorityFeeEstimate` on the signed tx → fallback p75 of `getRecentPrioritizationFees` over the tx's writable accounts → `min`; clamped to [min,max]; +50%/attempt capped 8×; V15),
  `src/ledger.ts` (`PgLedger` + `MemoryLedger`: built → sent → confirmed/failed), `src/rpc.ts` `Sender` (simulate once,
  send with `skipPreflight`, confirm by blockhash; retry only on expiry; every outcome in the ledger).
- Tests: `test/rpc.test.ts` (6: happy path, 3 retries with bumped fees, give-up at 5, simulation failure never sends,
  confirmed-with-error fails, bump table), `test/config.test.ts` (4), `test/fees.test.ts` (5: Helius shape, -32601 fallback, all-zero window → min, max clamp, malformed response).

- Task 3: `src/coins.ts` — `discoverCoins(rpc)` lists vault `Coin` accounts by discriminator (memcmp offset 0),
  decodes with `@satpad/sdk`, skips undecodable accounts, sorts by mint; `upsertCoins(db, list, slot)` mirrors the
  registry subset (payee, mode, paused, bonding curve, created_at, updated_slot) into `coins` with upsert-by-mint that
  leaves indexer-owned columns alone. Tests: decode/filter/sort with a mocked RPC; Postgres insert-then-update.

## How to run
```bash
docker run -d --name satpad-postgres -e POSTGRES_USER=satpad -e POSTGRES_PASSWORD=satpad -e POSTGRES_DB=satpad -p 55433:5432 postgres:16-alpine
pnpm db:migrate && pnpm --filter @satpad/db test
```

## Deferred
- Tasks 3–8 (STATUS.md). Helius free-tier inclusion of the fee API unconfirmed (V15) — the fallback path covers it.

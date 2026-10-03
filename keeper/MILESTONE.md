# keeper — milestone 3 (in progress)

## Built
- Task 1: `packages/db` — Drizzle + Postgres 16. Tables `coins` (registry subset), `ledger` (every keeper/admin tx:
  type enum, mint, actor, base-unit string amounts in jsonb, status built→sent→confirmed/failed, attempts, slot),
  `keeper_health` (last ok tick per loop/instance). `connect()`, `runMigrations()`, `pnpm db:generate` / `db:migrate`.
  Tests create a throwaway database per run and skip with instructions when Postgres is unreachable.

- Task 2a: `src/config.ts` (env → `KeeperConfig`, bigint thresholds, ≤ 5 attempts enforced, `describeConfig` redacts
  API keys and DB passwords), `src/keys.ts` (64-byte JSON keypairs, never logged), `src/log.ts` (JSON lines, bigint-safe,
  no library), `src/fees.ts` (`PriorityFeeProvider`; `FixedFeeProvider` +50%/attempt capped 8×; Helius pending V15),
  `src/ledger.ts` (`PgLedger` + `MemoryLedger`: built → sent → confirmed/failed), `src/rpc.ts` `Sender` (simulate once,
  send with `skipPreflight`, confirm by blockhash; retry only on expiry; every outcome in the ledger).
- Tests: `test/rpc.test.ts` (6: happy path, 3 retries with bumped fees, give-up at 5, simulation failure never sends,
  confirmed-with-error fails, bump table), `test/config.test.ts` (4).

## How to run
```bash
docker run -d --name satpad-postgres -e POSTGRES_USER=satpad -e POSTGRES_PASSWORD=satpad -e POSTGRES_DB=satpad -p 55433:5432 postgres:16-alpine
pnpm db:migrate && pnpm --filter @satpad/db test
```

## Deferred
- Task 2b (Helius fee provider, V15), tasks 3–8 (STATUS.md).

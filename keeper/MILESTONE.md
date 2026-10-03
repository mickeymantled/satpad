# keeper — milestone 3 (in progress)

## Built
- Task 1: `packages/db` — Drizzle + Postgres 16. Tables `coins` (registry subset), `ledger` (every keeper/admin tx:
  type enum, mint, actor, base-unit string amounts in jsonb, status built→sent→confirmed/failed, attempts, slot),
  `keeper_health` (last ok tick per loop/instance). `connect()`, `runMigrations()`, `pnpm db:generate` / `db:migrate`.
  Tests create a throwaway database per run and skip with instructions when Postgres is unreachable.

## How to run
```bash
docker run -d --name satpad-postgres -e POSTGRES_USER=satpad -e POSTGRES_PASSWORD=satpad -e POSTGRES_DB=satpad -p 55433:5432 postgres:16-alpine
pnpm db:migrate && pnpm --filter @satpad/db test
```

## Deferred
- Tasks 2–8 (STATUS.md).

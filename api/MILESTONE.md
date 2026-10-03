# api — milestone 4 (in progress)

## Built
- Task 6: Fastify 5 (D16) read-only API over the indexer tables. `src/prices.ts`: `PriceProvider` — `PythPriceProvider`
  (on-chain `PriceUpdateV2` decode of the sponsored BTC/USD account, owner/feed-id/staleness checks; V7),
  `FixedPriceProvider` (fork/tests), `CachedPriceProvider`; `satsToUsd` floors to cents with bigint. `src/format.ts`:
  every amount is `{ base, ui[, usd] }`. `src/queries.ts`: list/detail with 24 h volume, mcap (vq×supply/vt, floored),
  curve progress (1 − real/initial reserves), fee totals; trades/holders/rewards/ledger pages; `/stats`. `src/app.ts`:
  `GET /coins?sort=volume24h|newest|mcap|trending|pays_holders&stage=&pays_holders=&limit=&offset=`, `/coins/:mint`
  (+ fee account addresses), `/coins/:mint/trades|holders|rewards`, `/ledger?type=`, `/stats`, `/healthz`;
  `@fastify/rate-limit` (default 120/min); 2 s cache headers. Tests (10): formatting, Pyth decode/guards/cache, every
  endpoint against a seeded Postgres incl. sorts, filters, pagination, 400/404, 429.

- Task 7: `src/live.ts` `LiveHub` — one pg client `LISTEN satpad_live` (the processor's `pg_notify` on trades and
  registrations), fan-out to every `WS /live` socket, hello frame on connect, slow sockets dropped above 1 MB
  buffered; `/healthz` reports `liveClients`. Test: two real `ws` clients receive both notifications in order.

## Deferred
- Task 8 API-vs-chain check.

# Status

**Current milestone:** 3 — Keeper, claim and settle loop (M2 approved by human 2026-10-02; M3 code BLOCKED on the V14 investigation, one session, then plan)
**Last completed step:** M3 task 7 — `scripts/fork-keeper-check.ts` reconciler (ledger→chain: every confirmed row has a matching `Settled`/`PayeePaid` event with equal mint+amounts, collects exist on chain; chain→ledger: every vault event has exactly one confirmed row; failed/stuck rows reported; per-coin trade→settle lag). Live fork: 24 rows ↔ 14 events, 0 problems, max lag 43 s; a forged row makes it exit 1. `.github/workflows/keeper-reconcile.yml` written (fork + Postgres service + seed/trade/keeper/check on every push) — uncommitted until the token has `workflow` scope. Earlier: task 6 — `scripts/lib/fork.ts` (shared fork helpers: funding, wBTC mint, launch table, v0 launch), `scripts/fork-seed-coins.ts` (vault init with distinct wallets + N coins via the real launch flow, payees Me/Wallet/Holders round-robin; writes `scripts/fork-keys/seed.json`), `scripts/fork-trader.ts` (random buys/sells). Verified on the fork: 10 coins, 84 trades/0 errors, then `keeper --once` → 10 collect + 10 settle + 4 pay_payee rows confirmed, Holders and ATA-less payees correctly skipped. Earlier: task 5 — `scheduler.ts` (serialised ticks, consecutive-failure count, alert once at 3, `--once`), `health.ts` (`/healthz`, 503 when stale/failing), `alerts.ts` (Telegram + no-op), `main.ts` wiring (Postgres ledger, live/fixed fees, keeper_health upsert, SIGTERM), `Dockerfile` + `railway.toml`; 4 tests (28 keeper tests). Earlier: task 4 — `keeper/src/loops/settle.ts` `settleTick`: per coin, collect (≥ dust) → settle (re-read balance; split amounts in the ledger; treasury-only path) → pay_payee only when the payee ATA exists; paused coin/vault skips; per-coin try/catch; graduated AMM vault flagged for M6; `src/chain.ts` `RpcChainReader`. 7 scenario tests (24 keeper tests). Earlier: task 3 — `keeper/src/coins.ts`: `discoverCoins` (getProgramAccounts on the `Coin` discriminator, SDK decode, garbage-tolerant) + `upsertCoins` (registry subset into `coins`, indexer-owned columns untouched); 2 tests (17 keeper tests). SDK `PayeeMode` narrowed to on-chain values. Earlier: task 2 — keeper `config.ts` (env, redacted describe), `keys.ts`, `log.ts` (JSON lines), `fees.ts` (provider interface, fixed + bump), `ledger.ts` (Postgres + memory stores), `rpc.ts` `Sender` (simulate → send → confirm, bumped-fee retry on expiry ≤ 5, ledger built→sent→confirmed/failed); 10 tests. `LiveFeeProvider` (Helius → `getRecentPrioritizationFees` p75 → min, clamped, bumped) per V15; 15 keeper tests.
**Next step:** M3 soak re-run #2 ends ~2026-10-06T10:17Z → commit its summary + rolling totals and close M3. Then present the M7 plan (holder rewards) and wait for go. Done 2026-10-05 after M6 approval: D22 mitigations (idle-balance alert); Settle frame refactor session — v3 now passes everything, root cause recorded in D15, upstream #129 updated, deployable arch still v2. M6 stack is torn down (only the :8999 validator may still run; soak processes untouched).
**Blockers:** none for M3 code — V14 session done (D15): mainnet accepts SBPF v2; v3 bug isolated to the full `settle` validation frame; toolchain pinned (Anchor 1.2.0 / cargo-build-sbf 4.1.0 / platform-tools v1.57 / arch v2); CI `verify-build.yml` added; audit scope in `docs/AUDIT_SCOPE.md`. Upstream issue drafted, not filed.

## Toolchain (installed 2026-10-02)
Solana/Agave CLI 4.1.2 (cargo-build-sbf 4.1.0) at `$HOME/.local/share/solana/install/active_release/bin`; Rust 1.99.0 + Anchor CLI 1.2.0 via rustup/avm (`source ~/.cargo/env`); `solana-verify` 0.5.2; Node 22.22.3; pnpm 11.3.0; Docker 29.8 (arm64 — no amd64 verifiable image runs).
Dev keys (all gitignored under `keys/`): `satpad_vault-dev.json` (program id `52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93`), `recovery-dev.json` (`CTsAbZqVBmfb2NgUr8BJ9CUCmj1vMqrR3kWA8k6Wcmog`), `upgrade-authority-dev.json` (`U3CGV1FvYBnHDf9CNmEwEMW97CXE1BWo1pK7QqvNKav`), `deployer-dev.json`, `admin-dev.json`.

## Milestone 1 — closed 2026-10-02 (human approved)
See `packages/sdk/MILESTONE.md`. Commits `9f4af84` … `2ab222d`.

## Milestone 2 — closed 2026-10-02 (pending review)
DoD (SPEC, per D1): a coin's creator fee settles four ways through `satpad_vault` on the fork; LiteSVM suite green; verifiable build hash recorded (local hash recorded; Docker hash deferred, D13). **Met** except the Docker hash.

### Commits
- D9 constants — `(see log)` · task 1 scaffold + Config + initialize — `8a5086f` · task 2 declare_coin — `1bebe2c` · task 3 settle — `c296453` · task 4 payee — `d85423a` · task 5 rewards + LP — `f71f35e` · task 6 admin — `99829cb` · task 7 SDK + scripts — `2d39c90`, `c1ed409` · task 8 fork load + hashes — `23c9165` · task 9 launch ALT + DoD — `04197bb`

### DECISIONS this milestone
D9 constants/gates (approved) · D10 LiteSVM harness (in effect) · D11 SBPF v2 builds — **corrected: v3 is broken on the real validator too** (in effect) · D12 `REWARDS_MIN_RELEASE` (proposed) · D13 verifiable build deferred to amd64 (proposed) · D14 launch v0 + lookup table (in effect)

### Tests added
`tests/vault/{initialize,declare_coin,settle,payee,rewards_lp,admin}.test.ts` — 66 LiteSVM tests covering every SPEC "Program tests" bullet: split math at every bound, declaration refusals, atomic payee payouts, draw_lp caps/interval/signer, release_rewards hash-first/hourly/wallet, recover paused-only/fixed address, admin cannot set_lp while a mock multisig can. Rust unit tests for split/bounds and the mainnet recovery-address guard. `packages/sdk/test/{vault,launch}.test.ts` — 13 tests. `scripts/fork-m2-settle.ts` — 10 on-chain checks.

### Deferred
See `programs/satpad_vault/MILESTONE.md` "Deferred". Open VERIFIED items: V5–V11, V14 (partial).

### M3 soak summary (written by scripts/fork-soak.sh)
- Window: 2026-10-03T09:49:34Z → 2026-10-03T18:15:08Z (30334s of 86400s planned), 10 coins, trade every 3000 ms, keeper settle interval 60000 ms
- Trades: 9200 (0 errors) · keeper ticks ok/failed: 0/0 · per-coin failures: 0
- Settles: ? · payouts: ? · reconciler problems: ? (exit 1) · max per-coin trade→settle lag: ?s
- Final /healthz: {}
- **Definition of done: NOT MET** (ledger rows match chain: NO; unattended for 30334s)

### M3 soak — result and analysis (2026-10-05)
The script's summary above says NOT MET, and that is correct, for two reasons unrelated to the keeper's behaviour:
1. **The keeper was killed by me at 2026-10-03T11:24:55Z**, 95 minutes into the soak: a `pkill -f "indexer/src/main.ts|tsx src/main.ts"` meant to restart the indexer also matched the keeper (`keeper/src/main.ts` runs as `tsx src/main.ts`). The keeper log ends with `shutting down SIGTERM`; the trader kept trading (9,200 trades, 0 errors) with nobody settling. Lesson recorded in CLAUDE-level notes: kill by pid/port, never by `tsx src/main.ts`.
2. **The host session ended at ~2026-10-03T18:13Z** (validator, indexer, API, web, colima/Postgres all gone; machine not rebooted), which is why the window closed at 30,334 s and the final reconciler/health calls failed (`/healthz: {}`; the check scripts also hit a tsx loader error `r.register is not a function` — see below).
What the soak did show while the keeper ran (rolling sidecar `.fork-ledger/soak-rolling.json`, 1,199 windows): **79 settles, 31 payouts, 0 reconciliation problems, max trade→settle lag 62 s**, 3 false positives cleared (rows seen in `sent` mid-confirmation; checker now treats `sent` rows < 90 s old as in-flight). Indexer ran alongside at ≤ 4 req/s.
**Decision (loop rule 9, red → plan):** re-run the 24 h soak on a fresh fork with the Pyth clone (M3 close-out item 2 done first); M3 stays open until it is green. M6 development runs against a **second** validator instance (`RPC_PORT=8999`, own ledger dir, own database) so the soak is never touched.

## Milestone 3 — Keeper, claim and settle loop (human said "go" 2026-10-03, with two additions)

**Definition of done (SPEC, read per D1):** ten coins on the local fork settle unattended for 24 hours; ledger rows match on-chain events exactly.

**Design notes**
- Keeper = one Node 22 service (`keeper/`), three hot keys (keeper, LP, rewards) from env paths. M3 builds only the claim-and-settle loop (+ pay_payee); buyback (M6) and holder rewards (M7) are separate loops later but share the same runtime.
- `ledger` table (SPEC "Tables") is the keeper's write path and later the indexer's: Postgres 16 + Drizzle in a shared `packages/db` so M4 reuses the schema. Local Postgres via Docker (a `postgres:16-alpine` container is already running on this machine; the keeper uses `DATABASE_URL`).
- Coin discovery: M4's indexer does not exist yet, so the keeper lists `Coin` accounts via `getProgramAccounts` (discriminator filter) each tick and caches them. Swapped for the indexer DB in M4.
- Unclaimed fee detection: balance of pump's `creator_vault` quote ATA (`coinAccounts(mint, coinFee).creatorVaultQuoteAta`); the PumpSwap leg only after graduation (M6 owns PumpSwap; M3 handles curve-stage only and logs a TODO row when a pool exists).
- Priority fees: Helius `getPriorityFeeEstimate` behind an interface; the fork uses a fixed fallback. Retry with bumped fee on blockhash expiry, max 5. Every transaction is logged to `ledger` before send (status `sent`) and after confirmation (`confirmed` / `failed`), with signature, type, mint, amounts.
- 24-hour soak on the fork needs trading: `scripts/fork-trader.ts` buys/sells randomly across the seeded coins so fees keep accruing. The soak runs as a background job on this machine; the DoD check compares `ledger` rows to `Settled`/`PayeePaid` events parsed from the fork's transaction history.

**Tasks (one commit each, vitest with every task):**

Done: task 1 — `dd67aa4` · task 2 — `ccf0a1c`, `ce04da4` · task 3 — `254118a` · task 4 — `68511e6` · task 5 — `38adad8` · task 6 — `66de03e` · task 7 — `c6dd3e9` · task 8 — (this commit)

1. `packages/db`: Drizzle schema for `ledger` and `coins` (registry subset), migrations, `pnpm db:migrate`; test against local Postgres (skips with a clear message if `DATABASE_URL` is unset).
2. `keeper/src/config.ts` + `keys.ts`: env parsing (zod), keypair loading, never logs secrets; `keeper/src/rpc.ts`: connection, priority-fee provider interface (Helius impl + fixed fallback), `sendWithRetry` (simulate, bump fee on expiry, ≤ 5 attempts) with ledger before/after hooks; tests with a mocked Connection.
3. `keeper/src/coins.ts`: `Coin` account discovery via `getProgramAccounts` + decode, cached per tick; test against LiteSVM-style fixtures (encoded accounts).
4. `keeper/src/loops/settle.ts`: per-coin pipeline — unclaimed ≥ dust → `collect_creator_fee_v2` → `settle` → `pay_payee` if the payee ATA exists; per-coin try/catch so one failure never blocks others; idempotent re-entry; tests with mocked chain state.
5. `keeper/src/main.ts`: loop scheduler (60 s), `/healthz` with last successful tick per loop, structured JSON logs, alert hook (Telegram impl + no-op) firing after 3 consecutive loop failures; Dockerfile + `railway.toml` (no deploy yet).
6. `scripts/fork-seed-coins.ts` (ten coins via the M2 launch flow, mixed Me/Wallet/Holders payees) and `scripts/fork-trader.ts` (random buys/sells, configurable rate).
7. `scripts/fork-keeper-check.ts`: reconciles `ledger` rows with on-chain `Settled`/`PayeePaid` events over the soak window; exits non-zero on any mismatch. **(human addition)** `.github/workflows/keeper-reconcile.yml`: on every push, boot the fork on the runner (mainnet clones over public RPC), seed 3 coins, trade briefly, run the keeper for a few ticks against a Postgres service container, run the reconciler — ledger drift fails the build.
8. Soak: fork + seed + trader + keeper for 24 h in the background; **(human addition)** when it finishes it writes a summary (settles, failures, max per-coin lag between fee accrual and settle) into `STATUS.md` and `keeper/MILESTONE.md`; close M3.

**Needs human before task 1:** none (Postgres and Drizzle are named in SPEC). Telegram alerts need a bot token only when deployed.

## Milestone 6 — Reserve — closed 2026-10-05 (approved by human 2026-10-05; human said "go" 2026-10-04; swap-sdk dep approved; set_satpad per D21; D22 proposed)

**Definition of done (SPEC, per D1):** $SATPAD on the fork with a graduated PumpSwap pool; LP loop with burn and buyback loop running; LP mint supply is net zero after ten runs.

**Order:** M3 close-out first (soak ends ~2026-10-04 09:51 UTC; the fork restart it needs is also needed here for the extra PumpSwap clones), then M6.

**Verification before code (VERIFIED.md):**
- V5 — graduation threshold for a BTC-quoted curve: derive from the fork's QuoteControl/Global (`initial_virtual_quote_reserves = 5,082,192` sats, real token reserves), then confirm by buying a fork coin out and observing `complete = true`.
- V17 (new) — `migrate_v2` is callable by anyone: the IDL (`idl-ref/pump.json`) lists `user` as its only signer and `withdraw_authority` as a plain account; confirm on the fork by migrating the completed curve, record every account incl. the PumpSwap `amm_global_config`, pool PDAs, LP mint and which accounts `local-fork.sh` must additionally clone.
- V18 (new) — PumpSwap account lists and math from `idl-ref/pump_amm_sdk1.20.0.json` and `@pump-fun/pump-swap-sdk@1.20.0` (npm): `buy`/`buy_exact_quote_in`/`sell`, `deposit` (LP minted for a two-sided deposit), `collect_coin_creator_fee` (graduated coins' creator fees to the same CoinFee PDA, SPEC "Graduation"), LP mint supply semantics, pool fee tiers. Also: does the $SATPAD/BTC pool's `deposit` minted-LP amount equal what the keeper must burn (SPEC "burns exactly the LP tokens that deposit minted").

**Dependencies needing approval (CLAUDE.md):** `@pump-fun/pump-swap-sdk@1.20.0` in `packages/sdk` (the pinned IDL is already in `idl-ref/`). **Program change needing a human OK:** the vault's `Config` has `satpad_mint`, `satpad_pool`, `satpad_lp_mint` but no setter — add admin-only `set_satpad` (write-once, or until the pool is set) so SPEC "record the pool and LP mint addresses in Config" is possible after bootstrap; new verifiable build hash.

**Design notes**
- LP leg swap: direct PumpSwap `buy` on the $SATPAD/BTC pool (not Jupiter — V10 showed 3 lookup tables and 840–949 bytes for a Jupiter swap, which cannot share a transaction with `draw_lp` + `deposit` + `burn`; SPEC forbids splitting the draw). One transaction: `draw_lp` → `buy` (~half the drawn BTC → $SATPAD, slippage-capped) → `deposit` both sides → SPL `burn` of exactly the LP minted (read LP ATA delta in the same tx via a tiny vault-free check: burn amount = post-deposit LP balance, since the LP wallet never holds LP otherwise) → alert if LP mint supply after > before. Lookup table if needed (D14 pattern).
- Buyback loop: swap the buyback wallet's wBTC balance → $SATPAD on the pool and burn (SPL burn of the bought amount), min-balance skip, ledger rows `buyback`.
- Keeper hot keys: LP wallet + buyback wallet keypairs via env paths like the keeper key (fork keys in `scripts/fork-keys/seed.json` already exist for both).
- Indexer: PumpSwap `BuyEvent`/`SellEvent` on registered pools (venue `pool`), `LpDrawn` + deposit/burn amounts into `lp_runs`, buyback rows, stats (`btcIntoLiquidity`, `satpadBurned`); stage Block from `CompletePumpAmmMigrationEvent` (decoder exists).
- Web: coin page trades through PumpSwap after graduation (SPEC "Trading"), pool-based chart; `/docs` addresses are M9.

**Tasks (one commit each, tests with every task):**
1. Fork graduation: `scripts/fork-graduate.ts` (buy a seeded coin out with minted wBTC, call `migrate_v2`, print pool + LP mint; `--dry-run`), extra `--clone`s in `local-fork.sh` (V17), indexer e2e: stage flips to Block, `pool` recorded. Records V5/V17.
2. SDK: PumpSwap wrappers (`pool`/`lp` PDAs, `buildAmmBuy`, `buildAmmSell`, `buildAmmDeposit`, `buildCollectCoinCreatorFee`, quote math from the swap SDK) + fixtures from the fork (V18). Dep approval.
3. Program: `set_satpad` + tests (bankrun/LiteSVM), audit-scope note, verifiable build (CI records the hash).
4. `scripts/bootstrap-satpad.ts` (`--dry-run`): launch $SATPAD through the normal flow with `treasury_only`, drive it through the curve, `migrate_v2`, `set_satpad`; run on the fork; `scripts/fork-keys/seed.json` gains the pool addresses.
5. Keeper: AMM collect in the settle loop for graduated coins; buyback-and-burn loop (300 s) with ledger + alerts; scenario tests.
6. Keeper: LP deposit loop (one transaction, lookup table if needed), LP-supply guard + Telegram alert, ledger rows; tests with a scripted chain.
7. Indexer + API + web: pool trades, lp/buyback ledger types, stats; coin page trading on PumpSwap after graduation; `fork-api-check` covers pool coins.
Done: task 1 — `c4a4dcf`; task 2 — `e5bbd89`; task 3 — `7d3bf34`; task 4 — `3e86666`; task 5 — `1c1b594`; task 6 — `4226e41`; task 7 — `412d10d`+`936d77f`; task 8 — (this commit): `scripts/fork-lp-check.ts` (`pnpm fork:lp-check`) — **DoD MET** on the M6 stack 2026-10-05T12:11Z: 10 confirmed LP runs (2 refused in simulation before the chain-time fix, nothing sent), 108,888 sats drawn, LP minted = burned = 229,567,392 (ledger and indexer agree), LP mint supply on chain 0, pool LP counter 47,994,725,345, reserves 182.86B base / 10,333,516 sats; `fork-api-check` 0 problems. Earlier: task 7 — indexer decodes PumpSwap `BuyEvent`/`SellEvent`/`DepositEvent` from `emit_cpi` (pool trades resolved via `coins.pool` → venue `pool`; LP runs merge draw + buy + deposit + burn into `lp_runs`), API `GET /reserve` (runs + totals, net LP supply change) and `/stats.satpadBurned` from confirmed buyback ledger rows, web `TradePanel` pool branch (`ammSwapState` quotes, `buildAmmBuy/Sell`, `data-venue`), e2e `pool.spec.ts` on the M6 stack (:3001/:8084/:8999) green; `coins.pool_base/quote_reserves` (migration 0003) from post-transaction balances, forward-only in slot order; mcap from the pool once graduated; `fork-api-check` extended (pool reserves, pool sync wait, lp_deposit/buyback rows) → **0 problems on a clean M6 stack** (3 coins incl. 2 graduated, 22 curve + 6 pool trades, settle/buyback/LP rows). 3 indexer + 1 API tests. Earlier: task 6 — `keeper/src/loops/lp.ts` (`planLpRun` sizing + `lpTick`: draw_lp → PumpSwap buy of half the budget → deposit → burn of exactly the LP minted, one v0 tx over the Reserve lookup table; gates: paused, bootstrap, on-chain `lp_draw_interval`, `LP_MIN_DRAW_SATS`; LP-mint-supply guard with Telegram alert + failure), `Sender` v0/lookup-table support, `ChainReader.mintSupply`, `scripts/create-reserve-alt.ts`, env `LP_WALLET_KEYPAIR`/`RESERVE_ALT`/`LP_*`; 6 new tests (35 keeper). Fork: 22-entry Reserve table, LP run confirmed `2qPYg3…` (drawn 2,021 sats, swapped 1,020, LP 3,803,878 minted = burned, LP mint supply 0→0). Earlier: task 5 — settle loop collects the PumpSwap creator vault of graduated coins (`collect_creator_fee` rows carry `venue: curve|pool`); `keeper/src/loops/buyback.ts` (every `BUYBACK_INTERVAL_MS`: whole buyback-wallet wBTC balance → PumpSwap buy on `Config.satpad_pool` → Token-2022 burn of exactly the tokens bought, one tx; skips below `BUYBACK_MIN_SATS`, when paused, or before bootstrap); `BUYBACK_WALLET_KEYPAIR` (D22, proposed). 5 new keeper tests (29). Fork: keeper `--once` on the M6 stack settled 3 coins incl. $SATPAD treasury-only and ran a buyback (2,015 sats → 33,126,834,583 $SATPAD burned, confirmed). Earlier: task 4 — `scripts/bootstrap-satpad.ts` (`pnpm bootstrap:satpad --stage launch|buyout|migrate|register|all [--dry-run]`; admin from `ADMIN_KEYPAIR` or the fork seed) — on the M6 fork: $SATPAD launched treasury-only by the admin, bought out (11,013,024 sats), migrated, `set_satpad` confirmed; `seed.json.satpad = {mint, pool, lpMint}`; indexer registers it as `block` with `treasury_only = true`. Earlier: task 3 — `set_satpad` (admin-only, write-once, `SatpadSet` event, `SatpadAlreadySet` error), 2 LiteSVM tests (68 program tests), SDK `buildSetSatpad`, `scripts/vault-set-satpad.ts` (`pnpm vault:set-satpad --mint --pool --lp-mint [--dry-run]`), AUDIT_SCOPE items 6 (set_satpad) and 7 (Settle frame-size estimate, open). New verifiable hash recorded by CI on this push. Earlier: task 2 — `packages/sdk/src/amm.ts` (`poolForMint`, `lpMintForPool`/`lpMintOf` (Token-2022), swap/liquidity state, `ammQuote*` bigint math, `buildAmmBuy/Sell/Deposit`, `ammDepositForSats/ForLp`, `buildAmmCollectCreatorFee`) over `@pump-fun/pump-swap-sdk@1.20.0`; `scripts/fork-amm-trade.ts` (buy, sell, deposit + burn in one tx with LP mint supply net zero, collect into CoinFee) and `scripts/capture-amm-state.ts`; 4 SDK unit tests on the captured state, 4 AMM tx fixtures for task 7; extra fork clones (AMM fee_config, volume accumulator, 11 fee-recipient wBTC ATAs); V18 recorded. Earlier: task 1 — `scripts/fork-graduate.ts` (dry-run prints the V5 cost; live: buy-out → `complete` → `migrate_v2` → pool + LP mint check), `local-fork.sh` clones PumpSwap `global_config`, `FORK_KEYS_DIR` so the M6 stack (`:8999`, `scripts/fork-keys-m6`, db `satpad_m6`) never touches the soak's files; indexer `--once` on the M6 db flips the coin to `block` with the pool; fixtures + 2 decoder tests; V5 + V17 recorded.

8. Close: `scripts/fork-lp-check.ts` runs the LP loop ten times on the fork (`set_lp` interval 300 s) and asserts LP mint supply net zero and reserves grown — the DoD; `keeper/MILESTONE.md` + `packages/sdk/MILESTONE.md` addenda.

## M3 close-out tasks (after the soak ends and the fork can restart — human queue 2026-10-03)
1. Commit the soak summary the script writes into STATUS.md / keeper/MILESTONE.md; include the indexer's `rpc rate` footprint and the rolling sidecar totals; close M3.
2. ~~done 2026-10-05~~ `scripts/local-fork.sh`: `--clone` the Pyth BTC/USD feed account `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` (+ receiver program `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` as upgradeable) so `PRICE_SOURCE=pyth` runs live on the fork (price frozen at clone time; staleness guard needs `PRICE_MAX_AGE_SECS` override on the fork).
3. ~~Record `indexer/test/fixtures/launch_v0.json` … and add the launch decoder test~~ — done 2026-10-03 during M5 task 7 (fixture captured from an e2e launch while still in retention; decoder reads `emit_cpi` inner instructions). Still worth re-capturing on a fresh fork so `pnpm fixtures:capture` records it too.

## Milestone 4 — Indexer and API — closed 2026-10-03 (approved by human 2026-10-03; human said "go" 2026-10-03; Fastify = D16)

DoD met: `pnpm fork:api-check` → 0 problems on the live soak fork (10 coins, 20 holder balances, ledger within retention). Evidence in `indexer/MILESTONE.md`, `api/MILESTONE.md`.

### Review gate
- DECISIONS: D16 (Fastify, approved). No deviations from SPEC.
- VERIFIED: V7 (Pyth on-chain feed; Hermes needs a key), V8 (Helius webhooks: best-effort, dedupe, polling reconciles).
- Tests added: db 5, indexer 20, api 11 — all Postgres-backed where it matters, decoders on fork-recorded fixtures.
- Deferred: launch fixture, Helius webhook live test, PumpSwap trades, Pyth live run. See MILESTONE files.

**Definition of done (SPEC):** `/coins` and `/ledger` match on-chain state for the fork set. Verified by a script that reads the chain directly and diffs the API.

**Constraints this session:** the M3 soak owns the running fork (port 8899), keeper (health on 8081) and trader — nothing restarts them. The indexer and API are built against that live fork read-only; it is the ideal data source (10 coins, continuous trades, settles every minute). No new accounts can be cloned into the fork until it restarts, so Pyth is behind an interface with a dev price until then.

**Design notes**
- Sources (SPEC "Sources"): production = Helius webhooks; dev/fork + startup backfill = polling `getSignaturesForAddress` over the vault program, each registered coin's bonding curve, and (after graduation) its pool. Both feed one `processTransaction(sig, tx)` path keyed by signature, so ingestion is idempotent and the two sources can overlap safely. Backfill starts from the vault's `Declared` events, as SPEC requires.
- Decoding: pump.fun `TradeEvent`/`CreateEvent`/`CompleteEvent` and PumpSwap events from the pinned IDLs (`idl-ref/`), vault events from the SDK parser. Holders are materialized from `postTokenBalances` deltas per transaction (no `getProgramAccounts` sweeps in the hot path).
- Stage (SPEC): `dust` < 10 buys, `mining` on the curve, `block` on the migration/complete event. `curve_progress_bps` from `real_token_reserves` vs the initial real reserves of the curve (no BTC threshold needed — VERIFIED V5 stays open but is not a blocker: progress is token-side).
- Fees: `fees` rows from `Settled` events; pump's protocol fee modeled (V2: 0.95% curve) so displayed volume reconciles.
- Prices: `PriceProvider` interface — Pyth BTC/USD on mainnet (V7 to verify the feed account + Pyth SDK shape), fixed dev price on the fork. USD fields are derived at read time, never stored.
- API: REST + WebSocket per SPEC. Node 22 has no built-in WebSocket *server*, so a small framework is needed — **proposal: Fastify + `@fastify/websocket`** (one dependency decision; SPEC names "REST + WebSocket" without a library). Amounts as base-unit strings plus a `ui` decimal field. Rate limiting via `@fastify/rate-limit`. Read-only.
- The keeper's `coins` upsert stays; the indexer owns the remaining columns (name/symbol/uri from `CreateEvent`, stage, progress, pool, graduated_at).

**Verification before code:** V8 (Helius webhook payload shape — raw vs enhanced, auth header, retry semantics, account-address filters, pricing) before task 3; V7 (Pyth BTC/USD feed account + read method) before task 6. Both via live docs; recorded in VERIFIED.md.

**Tasks (one commit each, vitest with every task):**
1. `packages/db`: tables `trades`, `holders`, `fees`, `rewards_runs`, `lp_runs`, `bridge_transfers`, `indexer_cursor`; `coins` gains name/symbol/uri/stage/progress/pool/graduated_at/buys/sells/volume columns; migration; tests.
2. `indexer/src/decode/`: pump curve events, PumpSwap events, vault events → typed records; token-balance deltas → holder deltas. Tests use transaction logs recorded from the live fork (`indexer/test/fixtures/*.json`, captured by a script).
3. `indexer/src/sources/`: `PollingSource` (signature cursor per address, confirmed commitment, overlap-safe) and `HeliusWebhookSource` (HTTP receiver, auth header, idempotent) — V8 first. Startup backfill from `Declared`.
4. `indexer/src/process.ts`: idempotent per-signature processing → `trades`, `holders`, `fees`, `coins` stage/progress/counters, `rewards_runs`, `lp_runs`; derived stats (24h volume, holder count, mcap in BTC). Tests against fixtures + Postgres.
5. `indexer/src/main.ts`: run polling against the live fork alongside the soak (read-only), health endpoint, Dockerfile/railway.toml. Verify all 10 soak coins and every settle appear. **(human note)** The indexer must not add RPC load that could skew the soak: token-bucket rate limit on its fork polling (configurable req/s), and it logs its request rate (per-minute counters) so the soak summary can show it ran alongside without affecting settle timing.
6. `api/`: Fastify app — `GET /coins` (sorts: volume24h|newest|mcap|trending|pays_holders; `stage` filter; pagination), `/coins/:mint`, `/coins/:mint/trades|holders|rewards`, `/ledger?type=`, `/stats`; `PriceProvider` (V7); amounts `{ base: string, ui: string }`; rate limit. Tests with a seeded Postgres.
7. `WS /live`: trade + new-coin stream from Postgres `LISTEN/NOTIFY` emitted by the processor; test with a real socket.
8. `scripts/fork-api-check.ts`: reads chain state for the fork's coins (curve reserves, counts of vault events) and diffs `/coins` + `/ledger`; exits non-zero on mismatch. **(human note)** also diffs the `holders` table against a fresh `getProgramAccounts` sweep of each coin's token accounts, because holders are built from balance deltas and that is where drift hides. Add to `keeper-reconcile.yml` as a second job. Close M4 (`indexer/MILESTONE.md`, `api/MILESTONE.md`).

Done: task 1 — `33d99e6` · task 2 — `621b048` · task 3 — `5838fc3` · task 4 — `78a9ba7` · task 5 — `51e9d8d` · task 6 — `b15ea2c` · task 7 — `c6dd3e9` · task 8 — (this commit)

## Milestone 5 — Web app core — closed 2026-10-03 (approved by human 2026-10-04; human said "go" 2026-10-03; D17/D18/D19/D20)

**Definition of done (SPEC, per D1):** a user with only SOL launches and trades on the fork from the UI.

**Constraints:** built against the live soak fork until it ends, then the restarted fork (with Pyth cloned). Jupiter cannot execute on the fork (no Jupiter program/route accounts there), so SOL→BTC auto-swap has two modes: production = Jupiter v6 quote → swap transaction → client-side simulation → sign (V10 verifies the route and shapes against mainnet, read-only); fork = a dev-only faucet swap (SOL → wBTC at a fixed rate via the fork's patched mint authority) behind `NEXT_PUBLIC_DEV_SWAP=1`, never built into production bundles — **proposal D17**.

**Design notes**
- Next.js 15 App Router, React 19, TypeScript strict, dark theme; every number shown as BTC / sats / USD (USD from `/stats`' `btcUsd`). Wallet-adapter with Phantom, Solflare, Backpack, plus the adapter package's unsafe burner wallet in dev/e2e only. Every transaction is built client-side from `@satpad/sdk` and simulated before the wallet prompt (SPEC "Wallet and transactions").
- Launch tx = v0 + the pinned static lookup table (D14; address from `NEXT_PUBLIC_LAUNCH_ALT`, created once per deployment by `scripts/create-launch-alt.ts`). Launch fee, `declare_coin`, optional first buy as in M2's DoD script. If the SOL swap does not fit, it goes first as its own transaction and the UI waits for finality (SPEC).
- Coin metadata: D18 — pump.fun IPFS upload primary if V16 confirms; Postgres-backed `POST /metadata` (`GET /m/:id.json`, `/m/:id.png`) as fallback and fork path; active backend in API `GET /config`.
- Chart: price from `/coins/:mint/trades` (curve) with a small canvas chart component — no charting dependency unless you want one (lightweight-charts would be a new dep).
- Priority fee for user transactions: the API exposes `GET /fees/priority` using the keeper's `LiveFeeProvider` logic (Helius when configured, else recent fees), so no API key reaches the browser. CSP: self + wallet adapters + RPC origin; no third-party scripts.
- Pages per SPEC: `/` (hero coin, stats bar, grid with stage filters + sorts, just-launched strip, live ticker from `WS /live`), `/coin/:mint` (chart, buy/sell with slippage in BTC and SOL auto-swap, holder-rewards badge, payee + fee account links to Solscan, trades/holders tabs, "Buy with native BTC" placeholder linking to `/btc` which is M8), `/launch` (form, payee choice Me/Wallet/Holders, optional first buy, full simulation with every instruction listed before the wallet prompt). Footer disclosure on every page. `/btc`, `/ledger`, `/docs` are M8/M9 (stub routes with the disclosure only).

**Verification before code:** V10 (Jupiter v6 quote/swap API shapes, SOL→wBTC route depth, versioned tx + ALT handling) before task 6. V16 only if you choose pump.fun's upload endpoint for metadata.

**Dependencies needing approval (CLAUDE.md):** `next@15`, `react@19`, `@solana/wallet-adapter-{base,react,react-ui,wallets}`, `tailwindcss` (styling; or plain CSS modules if you prefer zero deps), `@playwright/test` (e2e against the fork — SPEC names e2e tests). Optional: `lightweight-charts`.

**Tasks (one commit each, tests with every task; unit = vitest, e2e = Playwright):**
1. `web/` scaffold: Next 15 + strict TS + Tailwind, dark theme tokens, layout with footer disclosure, env plumbing (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_LAUNCH_ALT`, `NEXT_PUBLIC_DEV_SWAP`), typecheck/lint wired into the root scripts; Playwright config pointing at the fork + API + web.
2. `web/lib`: typed API client from the API's response shapes, `useLive()` over `WS /live`, amount/price formatters (sats ↔ BTC ↔ USD, bigint only), Solscan link helpers. Unit tests.
3. `/` home page with all SPEC elements, server-rendered from `/coins` + `/stats`, ticker hydrated from the live socket. Playwright: page renders the 10 fork coins, filters/sorts change the grid.
4. Wallet + transaction plumbing: wallet provider (Phantom/Solflare/Backpack + burner in dev), `useSendTransaction` that builds → simulates (shows instruction list + CU + fee) → signs → confirms with retry on expiry (reuse the keeper's fee bump logic in a browser-safe module), priority fee from `GET /fees/priority` (API task). Unit tests with a fake wallet.
5. `/coin/:mint`: chart, buy/sell panel (sdk `buildBuyV2`/`buildSellV2`, quotes via sdk curve math from live curve state, slippage in sats), payee/fee links, trades + holders tabs, rewards badge. Playwright: burner wallet with wBTC buys and sells on the fork; balances change.
6. SOL auto-swap: V10 → `web/lib/jupiter.ts` (quote, swap-tx build, simulation against mainnet RPC in a unit test, size check vs 1232 → separate tx when needed, refuse if simulated cost > input + 0.003 SOL) and the dev faucet swap for the fork (D17). The buy panel and launch flow use it when the wallet has no wBTC.
7. `/launch`: metadata upload (API `POST /metadata`), form validation (32-byte name), payee choice, optional first buy, v0 launch tx with the ALT, full instruction preview before signing; `scripts/create-launch-alt.ts`. Playwright: burner wallet with **only SOL** launches a coin (dev swap → launch → first buy) and the coin appears on `/` and `/coin/:mint` — the DoD.
8. Close: `web/MILESTONE.md` with the Playwright run as evidence; e2e job in CI (fork + API + indexer + web + Playwright, Chromium only).

Done: task 1 — `8e66abb` · task 2 — `4147ea3` · task 3 — `d78945a` · task 4 — `5025d50` · task 5 — `c550e5b` · task 6a (dev faucet swap, D17; V10 recorded) — `bdf6517` · task 6b (Jupiter production path) — `4e3ddcd` · task 7a (metadata backend D18, ALT script) — `fbf7be1` · task 7b (`/launch`, launch e2e = M5 DoD, launch-tx event decoding fix in the indexer) — `4d85180` · task 8 (close: D17 build-time gate, D20 launch size planner, web-e2e CI) — (this commit). Build check for D17: `web/scripts/check-no-dev-swap.sh` greps `.next` production output for the dev-swap marker.

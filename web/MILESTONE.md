# web — milestone 5 (in progress)

## Built
- Task 1: Next.js 15.5 (App Router, React 19, TS strict, Tailwind 4) scaffold as `@satpad/web`. Dark theme tokens in
  `app/globals.css`; `app/layout.tsx` with header nav and the SPEC disclosure footer on every page; stub routes `/`,
  `/coin/[mint]`, `/launch`, `/btc`, `/ledger`, `/docs`; `lib/env.ts` (NEXT_PUBLIC_* only). Wallets via Wallet Standard
  discovery (Phantom/Solflare/Backpack) + `@solana/wallet-adapter-unsafe-burner` for dev/e2e — the heavy
  `wallet-adapter-wallets` bundle is not used. `scripts/check-no-dev-swap.sh` (D17): `pnpm build` fails if the dev-swap
  marker appears in `.next` output. Playwright config (Chromium, starts `next dev` with `NEXT_PUBLIC_DEV_SWAP=1`,
  reuses a running server); `e2e/smoke.spec.ts` passes. Root `pnpm lint` also lints the web app.

- Task 2: `lib/api.ts` typed client mirroring the API responses (amounts stay base-unit strings), `lib/format.ts`
  (BTC / sats / USD / tokens / compact / pct / short / ago — bigint until the final string), `lib/links.ts` (explorer
  links aware of the custom cluster), `lib/live.ts` (`useLive()` over `WS /live` with backoff; `parseLiveEvent`
  validates shapes). Unit tests (3 suites) via vitest with the pump SDK inline fix; tsconfig target ES2022 for BigInt.

- Task 3: `/` — hero (biggest coin by mcap), stats bar (`/stats`), live ticker (`WS /live`), "Just launched" strip,
  coin grid with stage filters (All/Dust/Mining/Block/Pays holders) and sorts via URL params, cards showing BTC + sats +
  USD for mcap and 24 h volume. Server-rendered (`force-dynamic`, `no-store`). Components: `CoinCard`, `StatsBar`,
  `CoinFilters`, `LiveTicker`, `Money`, `StageBadge`. `@satpad/sdk` lost its explicit `"type": "commonjs"` so Turbopack
  accepts its ESM-syntax TypeScript. e2e `home.spec.ts` against the live soak fork: 10 coins, filters/sorts, ticker
  connects and shows a live trade.

- Task 4: `components/Providers.tsx` (ConnectionProvider + WalletProvider via Wallet Standard; burner adapter only
  when `NEXT_PUBLIC_DEV_SWAP=1`), `WalletButton` in the header. `lib/tx.ts` `sendWithWallet`: priority fee from the
  API's new `GET /fees/priority` (the keeper's `LiveFeeProvider` moved into `@satpad/sdk` so keeper, API and web share
  one implementation), build legacy or v0 (+ lookup tables), simulate once, `onPreview` with named instructions / CU /
  fee / size (user can cancel before any wallet prompt), sign, send `skipPreflight`, confirm by blockhash, retry on
  expiry with the keeper's bump curve, ≤ 5 attempts. Unit tests (4) with a fake wallet and scripted RPC; e2e: burner
  wallet connects from the header.

- Task 5: `/coin/[mint]` — header with stage/progress, rewards badge, pause flag; `PriceChart` (lightweight-charts,
  sats per token from indexed trades); mcap / 24 h volume / fees settled / holders tiles; `CoinTabs` (trades, holders,
  explorer links); `TradePanel` (live curve state via RPC every 10 s, SDK curve-math quotes, slippage presets in bps,
  idempotent quote-ATA creation, `buildBuyV2`/`buildSellV2`, `useTx` → `TxPreviewModal` before the wallet prompt,
  status/signature/error lines, "Buy with native BTC" → `/btc`); payee + fee-account links (CoinFee, fee ATA, pots,
  curve, pool). e2e `coin.spec.ts`: chart/tabs/links, burner connects, is funded from Node via the fork keys, buys
  0.0005 BTC of a soak coin and sells 1,000 tokens — both confirmed on the live fork.

- Task 6a (D17): API `POST /dev/faucet` (fork only; `DEV_FAUCET_KEYPAIR` = patched wBTC mint authority) builds a
  SOL→wBTC swap at a fixed 100,000 sats/SOL, partially signed server-side; `GET /config` reports `devFaucet` and the
  metadata backend; manual CORS allowlist (`CORS_ORIGINS`). Web: `lib/swap.ts` `loadSolSwapper()` returns the faucet
  swapper only when `NEXT_PUBLIC_DEV_SWAP=1` (build-time inlined so the dynamic import of `lib/devSwap.ts` is
  tree-shaken); `web/scripts/check-no-dev-swap.sh` fails a production build that still contains the marker.
  `SwapPanel` appears in the trade panel when the wallet holds no wBTC. `useTx` exposes simulation logs under the
  error line. e2e `sol-only.spec.ts`: SOL-only burner → faucet swap 0.5 SOL → buys 0.0002 BTC of a soak coin.
  V10 (Jupiter shapes + SOL→wBTC depth) recorded; fixtures in `web/test/fixtures/jupiter/`.

- Task 6b (V10): API `GET /swap/quote?lamports` and `POST /swap/instructions` proxy Jupiter (`api/src/jupiter.ts`;
  pair pinned to SOL → BTC_QUOTE_MINT, amount capped at 100 SOL, optional `JUPITER_API_KEY` never leaves the server,
  upstream errors → 502). `web/lib/jupiter.ts`: quote → swap-instructions (Jupiter's compute-budget instructions
  dropped in favour of ours) → lookup tables from RPC → size check against 1232 bytes → `sendWithWallet` simulation →
  refuse before the wallet prompt if signature + priority fee + new-ATA rent exceed 0.003 SOL → sign, send, confirm.
  The swap is always its own transaction (V10 sizes leave no room to compose with a launch). `loadSolSwapper()`
  chooses Jupiter when `GET /config` says `swap: "jupiter"`; `SwapPanel` debounces quotes to Jupiter's 0.5 req/s.
  Tests: 4 API (proxy shape, pair pinning, key forwarding, 502) + 6 web (decode, sizes, overhead math, happy path
  with a v0 transaction over 3 tables, refusal before signing, failed simulation). Live check 2026-10-03: the built
  transaction simulated on mainnet with an unsigned funded payer — 908 bytes, 3 tables, 177,421 CU, no error.

- Task 7 (D18, D14): API `POST /metadata` (`api/src/metadata.ts`: validation per SPEC "Metadata" — name ≤ 32 bytes,
  description gets "Launched on satpad", empty website → the coin's Satpad page; pump.fun IPFS multipart upload as the
  primary backend with automatic fallback to Postgres rows served at `GET /m/:id.json` + `/m/:id.png`; backend and
  `launchAlt` reported by `GET /config`), `coin_metadata` migration, `scripts/create-launch-alt.ts` (dry-run lists the
  static accounts). Web `/launch`: `lib/launch.ts` (context from vault Config + pump globals + lookup table, first-buy
  quote on a not-yet-created curve, `buildLaunchIxs` = create_v2 with creator = CoinFee → declare_coin → optional
  first buy) and `LaunchForm` (image as data URL, payee Me/Wallet/Holders, SwapPanel when BTC is short, v0 tx over the
  table with the mint keypair as extra signer via `sendWithWallet`, preview of all 6 instructions, redirect to the coin
  page once indexed). Tests: 3 API (normalize, api backend round trip, pump upload + fallback), 2 web unit, e2e
  `launch.spec.ts` — the M5 definition of done: a SOL-only burner swaps 0.3 SOL, launches "E2E …" with a 0.0001 BTC
  first buy and Holders payee; the coin page shows the name, the badge and the first buy as a trade; `/` lists it.
  Indexer fix found by this test: the launch transaction exceeds the runtime log limit ("Log truncated"), so pump
  events are now decoded from the `emit_cpi` self-CPI inner instructions first (logs as fallback, de-duplicated);
  `indexer/test/fixtures/launch_v0.json` captured from the e2e coin with a decoder test.

## Deferred
- Task 8 (STATUS.md).

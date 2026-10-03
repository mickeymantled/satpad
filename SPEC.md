# Satpad Spec

Oct 2, 2026 · @Brian

## Overview

Satpad is a memecoin launchpad on Solana where every coin is a real pump.fun coin quoted in Bitcoin instead of SOL. Each coin's creator fee is routed through an on-chain vault into protocol-owned liquidity, a buyback-and-burn, an operator share, and a deployer or holder-rewards share.

Pump.fun does the heavy lifting: token creation, bonding curve, graduation to PumpSwap, and the trade instructions. Satpad adds four things on top: a BTC quote mint choice, a fee-splitting vault program, a keeper that executes the split and the liquidity deposits, and a front end with native BTC in and out.

Working names: pad token is $SATPAD. Stage labels: Dust (fewer than 10 buys), Mining (on the curve), Block (graduated to PumpSwap). The shared liquidity pool is the Reserve. Rename freely; nothing in the program depends on these.

Pump.fun's Custom Pairs feature, launched 2026-09-09, already whitelists wrapped bitcoin as a quote asset, so the BTC quote mint is a selection, not a negotiation ([source](https://www.fxstreet.com/cryptocurrencies/news/pumpfun-launches-custom-pairs-for-tokenized-stocks-and-real-world-assets-on-solana-202609100558)).

## Scope and non-goals for v1

V1 ships the full loop with BTC as quote: launch, trade, graduate, split fees on chain, deepen one shared $SATPAD/BTC pool with burned LP, pay deployers or holders, and move BTC between Bitcoin L1 and Solana.

**In scope**

- Anchor program `satpad_vault` that receives every coin's creator fee and splits it on chain
- Keeper service that claims fees, settles splits, runs liquidity deposits, and pays holder rewards
- Indexer and public API for coin list, stages, trades, and transparency log
- Web app: coin list, coin page, launch flow, Move BTC page, Ledger (transparency) page, docs
- SOL to BTC auto-swap through Jupiter so users without BTC can still launch and buy
- Native BTC bridging in and out via NEAR Intents 1Click

**Out of scope for v1**

- Per-coin pots that holders could harvest by burning tokens. Satpad has one shared pool from day one, no harvest, and no migration path to maintain
- Shielded payouts and memo stamps. Bitcoin has no shielded pool. A Lightning payout or an OP\_RETURN receipt can come in v2 if wanted
- Mobile app, Telegram bot, any trading beyond pump.fun's curve and PumpSwap
- Pairing coins to $SATPAD itself. Pump.fun only allows admin-approved quote mints

**Hard dependencies the spec accepts**

- Pump.fun keeps the chosen BTC mint on its approved quote list
- The BTC wrapper's issuer stays solvent and redeemable
- NEAR Intents keeps BTC to Solana routes live

## System architecture and repo layout

Five components in one monorepo. Pump.fun and PumpSwap are external programs Satpad calls but never modifies.

&#91;embedded content: Satpad architecture · 9 components, 8 flows\]

Users act through the web app against pump.fun; every creator fee lands in the vault, and the keeper is the only thing that moves BTC out of it, within the program's bounds.

```
satpad/
  programs/satpad_vault/      Anchor program (Rust). Fee split, LP pot, payees, rewards pots
  keeper/                     Node or Rust service. Claims fees, settles, deposits LP, pays rewards
  indexer/                    Geyser or Helius webhook consumer -> Postgres. Coins, trades, stages, ledger
  api/                        REST + WebSocket over the indexer DB
  web/                        Next.js app. Coin list, coin page, launch, Move BTC, Ledger, docs
  packages/sdk/               Shared TS: PDAs, instruction builders, pump.fun v2 wrappers, bridge client
  scripts/                    Deploy, migrate, admin ops (every admin action is a script, not a UI)
  tests/                      Anchor tests (bankrun), keeper integration tests, e2e against devnet
  docs/                       Public docs source (rendered at /docs)
```

**Stack**

- Program: Anchor 0.30+, Rust, Squads v4 for upgrade authority
- Keeper and indexer: TypeScript on Node 22, `@pump-fun/pump-sdk` and `@pump-fun/pump-swap-sdk` for instruction builders, `@solana/kit` for RPC
- DB: Postgres 16 with Prisma or Drizzle
- Web: Next.js 15, wallet-adapter, Jupiter API v6 for SOL to BTC routing
- Infra: Railway for keeper, indexer, api, web; Helius or Triton for RPC and webhooks

## Pump.fun integration

Every Satpad coin is created with pump.fun's `create_v2` instruction with `quote_mint` set to the BTC mint, and traded with `buy_v2` and `sell_v2`. Satpad never forks pump.fun; it only chooses the quote mint and the creator fee recipient.

**Quote mint.** Pump.fun's v2 bonding curve added `quote_mint`, `associated_quote_bonding_curve`, `associated_quote_fee_recipient`, `associated_quote_buyback_fee_recipient`, `associated_creator_vault` and `associated_quote_user` accounts, and only admin-approved quote mints can be used ([pump-public-docs](https://github.com/pump-fun/pump-public-docs)). Wrapped bitcoin is on the Custom Pairs list. At build time, read the approved list from pump.fun's global config account or the create form and pin the exact mint in `packages/sdk/src/quoteMints.ts` as `BTC_QUOTE_MINT`. Do not hardcode from memory; the wrapper could be Wormhole wBTC, cbBTC or zBTC and only one may be approved.

**Decimals.** Wrapped BTC mints typically have 8 decimals, not the 6 or 9 of USDC and SOL. Store `quote_decimals` in the vault config at init and read it everywhere; never assume 6 or 9.

**Creation (one transaction).** The launch flow builds a single transaction with these instructions in order:

1. Optional: Jupiter swap SOL to BTC if the user has no BTC (may be split into its own transaction when size exceeds 1232 bytes; the app then waits for finality before step 2)
2. `create_v2` with name, symbol, URI, `quote_mint = BTC_QUOTE_MINT`, creator fee at the maximum pump.fun allows, creator fee recipient set to the coin's `CoinFee` PDA owned by `satpad_vault` (see program section)
3. System transfer of the launch fee (0.01 SOL, configurable) to the Satpad treasury
4. `satpad_vault::declare_coin` signed by the user and by the new mint keypair, writing the deployer's payee choice
5. Optional: `buy_v2` first buy in BTC

Atomic: all land or none. A coin created without step 3 and 4 is not registered and does not appear on Satpad.

**Metadata.** Name is 32 bytes max as on pump.fun. Description ends with "Launched on satpad" and an empty website field links back to the coin's page on Satpad so explorers show provenance.

**Trading.** The coin page calls `buy_v2` and `sell_v2` on the curve, and PumpSwap's `buy` and `sell` once graduated. All quote amounts are in BTC base units. Slippage is expressed in BTC. The UI shows BTC, sats, and a USD estimate from a price feed (Pyth BTC/USD).

**Fees pump.fun keeps.** Protocol fee is 0.95% on the curve and 0.25% after graduation on standard launches, and Custom Pairs use the same schedule. None of this reaches Satpad; model it in the indexer so displayed volume and fee totals reconcile.

**Graduation.** When the curve completes pump.fun migrates liquidity to a PumpSwap pool. The coin's creator fee continues to flow to the same `CoinFee` PDA on PumpSwap trades. The indexer flips the stage to Block on observing the migration event.

## satpad\_vault program

`satpad_vault` is the only custom on-chain code. It receives each coin's creator fee in BTC, splits it by a config the admin can tune only within hard bounds, holds the LP pot that only the LP wallet can draw within rate limits, and holds per-coin payee and rewards pots. Nobody has to trust the keeper or the web app for the split.

**Accounts (PDAs)**

| Account | Seeds | Holds |
| --- | --- | --- |
| `Config` | `["config"]` | admin, treasury, buyback wallet, rewards wallet, lp wallet, recovery (immutable), quote mint, quote decimals, split bps x4, lp draw max, lp draw interval, paused flag, launch fee lamports |
| `CoinFee` | `["coin_fee", mint]` | Token account owned by program. Pump.fun's creator fee recipient for this coin. Fees accumulate here until `settle` |
| `Coin` | `["coin", mint]` | mint, deployer, payee (Pubkey or `HOLDERS` sentinel), payee\_mode, paused, created\_at, declared (bool) |
| `PayeePot` | `["payee_pot", mint]` | Token account. Deployer-share BTC waiting for payout to the current payee |
| `RewardsPot` | `["rewards_pot", mint]` | Token account. Deployer-share BTC when payee\_mode is Holders, until a rewards run |
| `LpPot` | `["lp_pot"]` | Token account. Liquidity share from every coin, draining to the LP wallet in bounded draws |
| `RewardsRun` | `["rewards_run", mint, run_index]` | snapshot sha256, slot, amount released, timestamp |

**Instructions**

| Instruction | Signer | What it does |
| --- | --- | --- |
| `initialize` | deployer once | Creates Config with initial split and wallets |
| `declare_coin` | user + new mint keypair | Creates `Coin`, `CoinFee`, `PayeePot`. Writes payee choice. Refuses if mint already declared or if pump.fun bonding curve's creator fee recipient is not `CoinFee`. Collects launch fee to treasury |
| `settle` | anyone | Moves balance of `CoinFee` by current split: liquidity bps to `LpPot`, buyback bps to buyback wallet, operator bps to treasury, deployer bps to `PayeePot` or `RewardsPot`. Emits `Settled` event |
| `pay_payee` | anyone | Transfers full `PayeePot` to the current payee's BTC ATA. Never creates the ATA |
| `redirect_payee` | current payee | Sets a new payee wallet. Pays out waiting balance to old payee in the same instruction. Irreversible handoff |
| `set_holder_rewards` | current payee | Sets payee\_mode to Holders permanently. Pays out waiting balance to the old payee first. Nobody controls the share afterward |
| `release_rewards` | rewards wallet | Moves `RewardsPot` to the rewards wallet for one run. Requires: pot above min, last run older than 3600s, `RewardsRun` created with snapshot hash first |
| `draw_lp` | lp wallet | Moves up to `lp_draw_max` from `LpPot` to the LP wallet, at least `lp_draw_interval` seconds since last draw |
| `set_split` | admin | Changes bps within bounds. Applies to every later settle |
| `set_wallets` | admin | Changes treasury, buyback, rewards wallets. Never recovery |
| `set_pause` | admin | Pauses or unpauses all coins or one coin. A paused coin's `settle` refuses |
| `recover` | admin | Only while a coin is paused: moves its `CoinFee` balance to the fixed recovery address |
| `set_lp` | upgrade authority (Squads) | Sets lp wallet, `lp_draw_max`, `lp_draw_interval` within caps |

**Bounds the program enforces**

- Liquidity share never below 2500 bps of the creator fee (0.50% of trade at a 2% fee)
- Operator share never above 2000 bps of the creator fee (0.40% of trade)
- Four shares sum to 10000 bps
- `lp_draw_max` capped at a constant set at build time in BTC base units (roughly 0.005 BTC to start; justify the value in the code comment)
- `lp_draw_interval` never below 300 seconds
- `release_rewards` at most once per 3600 seconds per coin
- Recovery address is a constant, not a Config field
- No instruction moves BTC out of `LpPot` except `draw_lp`, and no instruction refunds anything sent to `LpPot`

**Authorities**

- Upgrade authority: a Squads v4 multisig vault, 2 of 3, from the first mainnet deploy. Never a single key
- Admin: a hot key for pause, split, wallet changes. Cannot upgrade, cannot set LP, cannot touch payees
- LP wallet and rewards wallet: keeper hot keys with narrow powers
- `$SATPAD` exception: all of the pad token's own creator fee goes to the treasury, flagged by a bool on its `Coin` account set at init

**Events.** `Declared`, `Settled`, `PayeePaid`, `PayeeRedirected`, `HolderRewardsSet`, `RewardsReleased`, `LpDrawn`, `SplitChanged`, `Paused`, `Recovered`. The indexer builds the Ledger page from these alone.

## Fee split

Every trade pays a creator fee in BTC, set at the maximum pump.fun allows for custom pairs, and the vault splits it four ways. The table assumes a 1.00% creator fee (`creator_fee_bps = 100`, DECISIONS D3, 2026-10-02): pump.fun's program accepts up to 300 bps but its published Custom Pairs range is 0.05% to 1%. The vault's `Config.creator_fee_bps` is capped at 100 by a program constant.

| Share | Of creator fee | Of trade at 1% fee | Destination |
| --- | --- | --- | --- |
| Liquidity (Reserve) | 2500 bps | 0.25% | `LpPot`, then $SATPAD/BTC pool, LP burned |
| Buyback | 2500 bps | 0.25% | Keeper buys $SATPAD on the pool and burns it |
| Operator | 1000 bps | 0.10% | Treasury. Pays keeper, RPC, indexer, team |
| Deployer's choice | 4000 bps | 0.40% | Deployer wallet, another wallet, or holders |

Bounds: liquidity never below 2500 bps, operator never above 2000 bps, no floor on the deployer's share. `set_split` refuses anything outside these.

A split change applies to every `settle` after it, including fees already sitting in `CoinFee` and fees still unclaimed at pump.fun. BTC already in `LpPot` or the pool is never affected.

$SATPAD itself is the exception: 100% of its creator fee goes to the treasury.

## Deployer share and holder rewards

Whoever launches a coin picks where the 4000 bps deployer share goes, in the same transaction as creation. The choice is written by `declare_coin`, signed by the new mint's keypair so only the launch page can write it, once.

**Payee modes**

- `Me`: the launching wallet. Default
- `Wallet(pubkey)`: any address. That wallet controls the share from the start; the deployer has none
- `Holders`: paid pro rata to holders. Permanent, nobody controls it afterward

Only the current payee can `redirect_payee` or `set_holder_rewards`. Both pay out whatever is waiting to the old payee in the same instruction, so no one can block a change by withholding a payout. Neither the admin nor Satpad can change a payee.

**Payouts.** `settle` puts the share into `PayeePot`. Anyone can call `pay_payee`; the keeper does it automatically whenever the payee has a BTC ATA and never pays rent to create one. A payee without an ATA claims on the coin page, which creates the ATA client-side first.

**Holder rewards, keeper side**

1. When `RewardsPot` is worth at least $25 (Pyth BTC/USD) and the last run is at least 3600s old, the keeper picks a random unannounced minute in the next hour
2. At that minute it snapshots every token account of the mint via `getProgramAccounts` or the indexer, filtered to wallets holding at least $20 of the coin
3. Excluded: the bonding curve, PumpSwap pool, lockers, burn addresses, Satpad's own wallets
4. It computes pro rata shares, writes the snapshot JSON to object storage, and calls `release_rewards` with the snapshot's sha256
5. It pays holders in batches of up to 20 transfers per transaction. A holder with no BTC ATA gets one created in the same transaction and the rent (about 0.002 SOL at BTC price) is deducted from their share and sent to the treasury. A share below twice the rent is skipped and rolls into the next run
6. Every snapshot, share list and transfer signature is published on the Ledger page

**What is enforced on chain vs off.** The pot can only move to the rewards wallet, once per hour per coin, after the hash is written. Who gets how much is computed by the keeper and verified publicly, not enforced by the program. Document this plainly in `/docs`.

## Protocol-owned liquidity: the Reserve

The Reserve is one $SATPAD/BTC PumpSwap pool that every coin's trades deepen and nobody can drain, because every LP token is burned the moment it is minted.

**Flow**

1. `settle` on any coin pays the liquidity share into `LpPot`
2. The LP wallet calls `draw_lp` for at most `lp_draw_max`, at least `lp_draw_interval` seconds after the last draw
3. In the same transaction the keeper: swaps roughly half the drawn BTC into $SATPAD on the pool, deposits both sides with PumpSwap `deposit`, and burns exactly the LP tokens that deposit minted
4. If any step fails the whole transaction reverts and the BTC stays in `LpPot`

Build step 3 as one transaction with `draw_lp` + Jupiter or direct PumpSwap swap + `deposit` + SPL `burn`. If it does not fit in 1232 bytes, use an address lookup table; do not split it, because a split lets drawn BTC sit in a hot wallet.

**Why burned LP cannot be withdrawn.** PumpSwap values each LP share against total LP supply. Burning reduces supply but the deposited tokens stay in the pool, so the burned share is permanent pool depth.

**Bootstrapping.** Before any coin can be launched, $SATPAD must exist with a graduated PumpSwap pool. Launch sequence: create $SATPAD through the normal Satpad launch flow on mainnet with the treasury-only fee flag, drive it through the curve (team buys plus public), wait for migration, record the pool and LP mint addresses in Config, then open launches to the public.

**Published addresses.** The pool, LP mint, `LpPot`, and LP wallet are listed on the docs page with Solscan links, and the Ledger page shows every draw, deposit and burn with its signature. The keeper's runs must never increase the LP mint's supply net; an alert fires if `LP mint supply after run > LP mint supply before run`.

## Keeper service

The keeper is a single long-running Node service with four loops, each idempotent and safe to restart mid-run. It holds three hot keys (keeper, LP wallet, rewards wallet) with the narrow powers the program grants them, and nothing else.

| Loop | Interval | What it does | Failure mode |
| --- | --- | --- | --- |
| Claim and settle | 60s | For each registered coin with unclaimed creator fees above a dust threshold: pump.fun `collect_creator_fee` (curve or PumpSwap variant) then `satpad_vault::settle`. Then `pay_payee` for any `PayeePot` whose payee has a BTC ATA | Per-coin; one coin failing never blocks the others |
| Buyback and burn | 300s | Swaps the buyback wallet's BTC balance for $SATPAD on the pool and burns it. Skips when balance is below a minimum to save fees | Retries next tick |
| LP deposit | `lp_draw_interval` | The one-transaction draw, swap, deposit, burn described in the Reserve section | Reverts atomically; alert after 3 consecutive failures |
| Holder rewards | 60s check | For each Holders-mode coin: pot value check, random minute scheduling, snapshot, `release_rewards`, batched transfers, publish | Snapshot and hash are durable before release; a crash after release resumes from the stored share list |

**Rules**

- Every transaction the keeper sends is logged to the `ledger` table with signature, type, coin, amounts, and status before send and after confirmation
- Priority fees via Helius `getPriorityFeeEstimate`; retry with bumped fee on blockhash expiry, max 5 attempts
- All amounts in base units as bigint; never floats
- No instruction the keeper sends can move funds anywhere the program does not already allow; a compromised keeper key loses at most one rewards run and one LP draw per interval
- Config via env: RPC URLs, key paths, thresholds, Pyth feed address, pool addresses. No secrets in the repo
- Health endpoint `/healthz` reports last successful tick per loop; Railway restarts on failure
- Alerts (Telegram bot) on: 3 consecutive loop failures, LP mint supply increase, `release_rewards` to an unexpected wallet, admin instruction observed on chain

## Indexer and API

The indexer consumes pump.fun, PumpSwap and `satpad_vault` events for registered coins only and writes Postgres; the API serves the web app and anyone else read-only.

**Sources.** Helius webhooks (or a Geyser plugin) filtered to: the pump.fun program, PumpSwap, `satpad_vault`, and the $SATPAD pool. On startup, backfill from the `Declared` event history so a fresh deploy rebuilds the full state.

**Tables**

| Table | Key fields |
| --- | --- |
| `coins` | mint, name, symbol, uri, deployer, payee, payee\_mode, stage (dust / mining / block), curve\_progress\_bps, bonding\_curve, pool, created\_at, graduated\_at, paused |
| `trades` | signature, mint, side, btc\_amount, token\_amount, price\_btc, trader, slot, venue (curve / pool) |
| `holders` | mint, wallet, balance, updated\_slot (materialized from token balance changes) |
| `fees` | mint, signature, creator\_fee\_btc, split applied (4 amounts), settled\_at |
| `ledger` | signature, type, mint, amounts, actor wallet, status, timestamp. Every keeper and admin transaction |
| `rewards_runs` | mint, run\_index, snapshot\_hash, snapshot\_url, pot\_btc, holders\_paid, skipped, transfer signatures |
| `lp_runs` | signature, btc\_drawn, satpad\_bought, lp\_minted, lp\_burned, pool\_reserves\_after |
| `bridge_transfers` | id, direction, solana\_wallet, intents\_deposit\_address, amount, status, created\_at (no Bitcoin addresses stored server-side beyond what NEAR Intents returns) |

**Derived fields.** Market cap in BTC and USD (Pyth), 24h volume, holder count, buys and sells, BTC paid to holders, and curve progress from the bonding curve's real and virtual reserves.

**API**

- `GET /coins?sort=volume24h|newest|mcap|trending|pays_holders&stage=` paginated
- `GET /coins/:mint` full detail plus fee account links
- `GET /coins/:mint/trades`, `/holders`, `/rewards`
- `GET /ledger?type=` the transparency feed
- `GET /stats` totals: coins launched, BTC into liquidity, $SATPAD burned, BTC paid to holders, BTC traded today
- `WS /live` trade and new-coin stream for the home page ticker
- All amounts returned as strings in base units plus a `ui` decimal field

## Native BTC in and out

Satpad trades in BTC on Solana. Users bring native BTC from Bitcoin L1 and send sale proceeds back to a Bitcoin address through NEAR Intents 1Click. Satpad never holds user funds in transit.

**Bringing BTC in (`/btc`, Bring tab)**

1. User connects a Solana wallet, enters an amount and a Bitcoin refund address
2. Browser requests a quote from the 1Click API directly (`POST /v0/quote`) with origin BTC, destination the BTC quote mint on Solana, recipient the user's wallet, and verifies the quote's signature
3. Page shows the one-time deposit address, exact amount, QR code, and two deadlines: the refund cutoff (about 80 minutes) and the hard expiry. The address is hidden 20 minutes before the refund cutoff
4. User sends from any Bitcoin wallet. Expect 1 to 3 Bitcoin confirmations before NEAR Intents releases; the page polls `GET /v0/status` and shows progress
5. BTC lands in the user's Solana wallet as the quote mint. If the wallet has no ATA, NEAR Intents creates it and the fee is higher; show both fee cases before confirming

**Paying out (sell tab, Send tab)**

- In the sell flow, a checkbox "Receive as native BTC" plus a Bitcoin address. The transaction sends exactly the sale's guaranteed minimum output to the 1Click deposit address in the same transaction as the sale; anything above the minimum stays in the wallet as BTC on Solana. Nothing is sent if the sale fails
- Send tab: same payout without a sale, for BTC the user already holds on Solana
- Address types: bech32 (bc1q), bech32m (bc1p taproot), legacy. Validate client-side; reject testnet prefixes

**Safety rules**

- Addresses come only from what the user typed or from a signed quote the browser requested itself; never from transaction history
- A transfer started in one browser shows its deposit address only in that browser; the `/btc/:id` status page in any other browser shows status alone
- Show the full address and tell users to compare every character
- NEAR Intents can delay or hold a transfer for compliance review; the UI says so and Satpad cannot release it

**Fees.** NEAR Intents charges a flat per-transfer fee plus the Bitcoin network fee it pays; show the quoted fee and the realized fee after completion. Satpad adds none. Bitcoin's minimum economic output and dust limit mean a payout under roughly 10,000 sats is refused client-side; read the live minimum from the quote.

**Fallback.** If 1Click has no BTC route at build time, the alternative is the wrapper's own mint and redeem (cbBTC via Coinbase, wBTC via its custodian), which is a redirect to their site, not an integrated flow. Confirm the route in the verification checklist.

## Frontend

Next.js app with six routes, dark theme, every number in BTC with sats and USD alongside.

| Route | Content |
| --- | --- |
| `/` | Hero card for the biggest coin, stats bar, coin grid with stage filters (Dust / Mining / Block / Pays holders) and sorts, "Just launched" strip, live trades ticker in BTC |
| `/coin/:mint` | Chart (curve or pool), buy and sell panel with SOL auto-swap, holder rewards badge, payee and fee account links, trades and holders tabs, "Buy with native BTC" that opens the bridge and returns |
| `/launch` | Form: name, symbol, image, description, socials, payee choice (Me / Wallet / Holders), optional first buy. Simulates the full transaction and shows every instruction before the wallet prompt |
| `/btc` | Bring and Send tabs as specified in the bridge section; `/btc/:id` status page |
| `/ledger` | Every keeper and admin transaction: settles, LP runs with before and after reserves, rewards runs with snapshot links, draws, split changes, pauses. Filterable, each row links to Solscan |
| `/docs` | How it works, fee split with live numbers from Config, who holds the keys with addresses, FAQ, risk disclosure, terms |

**Wallet and transactions**

- wallet-adapter with Phantom, Solflare, Backpack; every transaction built client-side from the SDK package and simulated before signing
- SOL to BTC auto-swap through Jupiter when the user lacks BTC, inside the same transaction when size allows, otherwise as a prior approval. Refuse the swap if the simulated cost exceeds input plus 0.003 SOL
- Priority fee from Helius estimate; launch-with-first-buy may run without one when near the size limit

**Copy and disclosure.** Footer on every page: independent project, not affiliated with pump.fun or any BTC wrapper issuer; coins can go to zero; the Reserve backs no single coin. Risk and terms pages before launch. Never DM first, never ask for keys.

## Security and key management

The design goal is that no single key, including the admin, can move the Reserve or any user's funds; the worst a stolen key can do is bounded and alerted.

| Key | Where it lives | Can do | Cannot do |
| --- | --- | --- | --- |
| Upgrade authority | Squads v4 vault, 2 of 3 hardware signers | Upgrade program, `set_lp` | Act without a second signer |
| Admin | Hardware wallet, used via scripts only | Pause, split within bounds, change treasury/buyback/rewards wallets, recover a paused coin to the fixed address | Upgrade, touch `LpPot`, change a payee, set LP params |
| Keeper | Railway secret, hot | Claim, settle, pay payees, buyback | Anything else |
| LP wallet | Railway secret, hot | `draw_lp` within limits, deposit, burn | Draw beyond `lp_draw_max` or faster than the interval |
| Rewards wallet | Railway secret, hot | Receive `release_rewards`, pay holders | Release more than once an hour per coin |

**Known residual risk.** The admin picks the rewards wallet, so a stolen admin key could point it at itself and drain rewards pots one run per coin per hour. Mitigation: alert on every `set_wallets`, keep the admin on hardware, consider moving `set_wallets` behind the multisig in v2.

**Program hygiene**

- Checked arithmetic everywhere; `u64` for base units, bps math via `u128` intermediates
- All token accounts validated against the Config quote mint; refuse any other mint
- `declare_coin` verifies the pump.fun bonding curve account's creator and fee recipient fields match `CoinFee` so a coin cannot register with fees pointed elsewhere
- No `init_if_needed` on pots; explicit init in `declare_coin`
- Audit by a Solana-specialist firm before mainnet, and a public bug bounty
- Verified build published (Anchor verifiable build, `solana-verify`) so anyone can match the on-chain bytes to the repo

**Web and ops**

- No secrets in the browser; the bridge quote signature check runs client-side against NEAR Intents' published key
- CSP, no third-party scripts beyond wallet adapters and Jupiter
- Rate limit the API; the indexer is read-only to the chain
- Official channels listed on `/docs`; Satpad never DMs first

## Testing and deployment

Ship devnet end to end before writing the audit scope, then mainnet in a gated order.

**Program tests (bankrun)**

- Split math at every bound; refusals outside bounds
- `declare_coin` refuses a second declaration, a wrong fee recipient, a non-quote mint
- `redirect_payee` and `set_holder_rewards` pay the old payee atomically; a third party cannot call them
- `draw_lp` refuses above max and before interval; no other key can call it
- `release_rewards` refuses without a `RewardsRun`, within the hour, or to a wallet other than rewards
- `recover` refuses on an unpaused coin and to any address but the constant
- Admin cannot upgrade; multisig path exercised with a mock Squads signer

**Integration tests (devnet)**

- Launch with and without first buy, with and without SOL auto-swap
- Full curve to graduation on a devnet pump.fun deployment if available; otherwise a local fork via `solana-test-validator` with pump.fun and PumpSwap program dumps
- Keeper loops against a seeded set of ten coins; assert ledger rows match on-chain events exactly
- One full holder-rewards run with 50 synthetic holders, including ATA-less holders and dust shares
- Bridge flow against NEAR Intents testnet if exposed, otherwise mocked with recorded responses

**Mainnet rollout**

1. Deploy `satpad_vault` with upgrade authority immediately transferred to the Squads vault
2. `initialize` Config with mainnet wallets and the pinned BTC quote mint
3. Launch $SATPAD, graduate it, record pool addresses, run the first LP deposit manually and verify the LP burn
4. Open launches to an allowlist for 48 hours; watch the Ledger
5. Public launch

**Observability.** Structured logs to Railway, Telegram alerts as listed in the keeper section, a public status line on `/docs` showing last tick per loop.

## Build-time verification checklist

Claude Code must confirm each of these from live sources before writing the code that depends on it. Pump.fun and the bridges change monthly and this spec was written from docs as of 2026-10-02.

- [ ] Which BTC mint(s) pump.fun currently approves as a quote: read the global config account or the create form, pin the address, note the wrapper and its decimals
- [ ] Maximum creator fee pump.fun allows on Custom Pairs (reports say 0.05% to 1%); set defaults accordingly
- [ ] Exact `create_v2`, `buy_v2`, `sell_v2`, `collect_creator_fee` account lists from the current `@pump-fun/pump-sdk` IDL, and PumpSwap `deposit` and `collect_coin_creator_fee` signatures from `@pump-fun/pump-swap-sdk`
- [ ] Whether pump.fun's creator fee recipient can be an arbitrary program-owned token account at creation (other custom-pair launchpads do this with a vault program; confirm it works for the BTC mint)
- [ ] Pump.fun graduation threshold for a BTC-quoted curve, in BTC base units
- [ ] NEAR Intents 1Click: BTC to Solana route availability, the destination asset id for the chosen BTC mint, min and max amounts, fee schedule, quote signature verification method
- [ ] Pyth BTC/USD price feed account on mainnet
- [ ] Helius webhook or Geyser pricing and the account filters needed
- [ ] Squads v4 program id and CLI for creating the upgrade authority vault
- [ ] Jupiter v6 route exists from SOL to the chosen BTC mint with acceptable depth
- [ ] Trademark check on "Satpad" and domain availability before anything public

## Milestones for Claude Code

Work in this order; each milestone is independently testable and the next depends on it.

1. **Repo and SDK.** Monorepo scaffold, `packages/sdk` with PDAs, Config types, pump.fun v2 wrappers for the pinned BTC mint, and a devnet script that creates a BTC-quoted coin and buys it. Done when a coin exists on devnet with `quote_mint = BTC_QUOTE_MINT`
2. **Vault program.** `satpad_vault` with all instructions, bounds, events; bankrun tests green; verifiable build. Done when a devnet coin's creator fee settles four ways
3. **Keeper, claim and settle loop.** Claims, settles, pays payees, writes ledger. Done when ten devnet coins settle unattended for 24 hours
4. **Indexer and API.** Webhooks to Postgres, all endpoints, WebSocket. Done when `/coins` and `/ledger` match on-chain state for the devnet set
5. **Web app, core.** Home, coin page, launch flow with payee choice and SOL auto-swap. Done when a user with only SOL can launch and trade on devnet
6. **Reserve.** $SATPAD on devnet, pool, LP loop with burn, buyback loop. Done when LP mint supply is net zero after ten runs
7. **Holder rewards.** Snapshot, hash, release, batched payouts, Ledger publishing. Done when the 50-holder test pays out correctly
8. **Bridge.** `/btc` Bring and Send, sell-to-native-BTC, status pages. Done when a testnet or small mainnet round trip completes
9. **Docs, risk, terms, Ledger page.** Live numbers from Config. Done when every address on `/docs` resolves on Solscan
10. **Audit and mainnet.** Audit scope from milestones 2 and 6, fixes, multisig deploy, $SATPAD launch, allowlist, public

Each milestone ends with a short `MILESTONE.md` in its package: what was built, how to run it, what was deferred.

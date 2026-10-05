# satpad_vault — milestone 2: Vault program

**Status: closed 2026-10-02 pending human review** (D13: Docker-verifiable hash deferred to an amd64 host).

## Built
- Task 1: Anchor 1.2 workspace (`Anchor.toml`, `Cargo.toml`, `rust-toolchain.toml` 1.89). `src/consts.rs`: every program bound
  (`MIN_LIQUIDITY_BPS`, `MAX_OPERATOR_BPS`, `MAX_CREATOR_FEE_BPS=100`, `LP_DRAW_MAX_CAP=500_000`, `MIN_LP_DRAW_INTERVAL=300`,
  `REWARDS_RUN_MIN_INTERVAL=3600`), `RECOVERY_ADDRESS` selected by the `mainnet` cargo feature (dev: `keys/recovery-dev.json`),
  `DEV_KEYS` + a `cargo test --features mainnet` guard that fails until a real mainnet recovery address is set (D9).
  `state.rs` `Config` (+ `creator_fee_bps`, `$SATPAD` pool fields, bumps). `instructions/initialize.rs` validates split,
  LP params, creator fee; reads quote decimals from the mint; creates `LpPot` (token PDA, authority = Config).
- Tests: `tests/vault/harness.ts` (LiteSVM, D10) + `initialize.test.ts` (6): every Config field, LpPot ownership,
  decimals read from mint, run-once, split bounds at the exact edges, LP caps, creator fee range.

- Task 2: `src/pump.rs` read-only `BondingCurve` view (discriminator + 125-byte layout pinned from `idl-ref/pump.json`).
  `state.rs` `Coin`, `PayeeMode { Wallet, Holders }`, `PayeeChoice { Me, Wallet(Pubkey), Holders }`. `instructions/declare_coin.rs`:
  signed by launcher + mint keypair; bonding curve must be pump's PDA for the mint, pump-owned, with `creator == CoinFee`,
  `quote_mint == Config.quote_mint`, `creator_fee_bps == Config.creator_fee_bps` (exact, D9), not holder-reward, not mayhem;
  inits `Coin`, `ATA(CoinFee, quote)`, `PayeePot`, `RewardsPot` (pots: authority = Config); transfers launch fee to
  `Config.treasury`; `treasury_only` only when launcher == admin; emits `Declared`.
- Tests: `tests/vault/fixtures.ts` (initialized Config, `injectCurve` writes a pump-owned BondingCurve into LiteSVM),
  `declare_coin.test.ts` (12): happy path incl. fee ATA/pots/launch fee, Me/Wallet/Holders, second declaration, missing mint
  signature, wrong creator, SOL-quoted and foreign-quoted curves, fee bps 0/99/101/300, holder-reward, mayhem, missing /
  wrong-owner / bad-discriminator curve, wrong treasury, foreign quote mint account, treasury_only non-admin, zero launch fee.

- Task 3: `instructions/settle.rs` — anyone can call; refuses when `Config.paused` or `Coin.paused`; no-op on empty
  ATA; `split_amount` floors buyback/operator/deployer and gives the remainder to liquidity (D7) via u128;
  transfers CPI-signed by the `CoinFee` PDA to `LpPot`, `ATA(buyback_wallet)`, `ATA(treasury)`, and `PayeePot` or
  `RewardsPot` by payee mode; treasury-only coins send 100% to treasury; `Settled` event. Destination ATAs are
  validated as ATAs of the configured wallets and must already exist.
- Tests: `settle.test.ts` (10): exact 10000 split, cumulative parity with `@satpad/sdk` `splitFee` at edge amounts,
  empty no-op, anyone-can-call, Holders → RewardsPot, treasury-only, split change applies to waiting fees, global and
  per-coin pause, every destination substituted with an attacker ATA, missing destination ATA. Rust unit tests for the
  split at u64::MAX and bound edges.
- `scripts/build-vault.sh`: `anchor build` + `cargo build-sbf --arch v2` (D11).

- Task 4: `instructions/payee.rs` — `pay_from_pot` (Config-signed transfer out of a pot). `pay_payee`: anyone, full
  `PayeePot` to `ATA(coin.payee)`, which must exist; refuses Holders-mode coins. `ChangePayee` accounts shared by
  `redirect_payee(new_payee)` and `set_holder_rewards`: signer must be `coin.payee`; the old payee's ATA is paid in the
  same instruction (can't block a change by withholding); new payee must be non-default and different; Holders sets
  `payee = default`, mode Holders, and nothing can change it afterwards.
- Tests: `payee.test.ts` (12): pay full pot / anyone / empty no-op / missing ATA refused / wrong ATA refused /
  settle→pot→payee; redirect only by current payee (deployer, admin, stranger refused), atomic old-payee payout then
  new payee receives later settles, default and same-payee refused, missing old ATA refused, `Wallet(pubkey)` payee
  controls from launch; holders switch pays old payee, is permanent, `pay_payee` refuses, settle routes to `RewardsPot`,
  third party refused.

- Task 5: `state.rs` `RewardsRun` (mint, run_index, snapshot_sha256, slot, amount_released, timestamp).
  `instructions/rewards.rs` `release_rewards(snapshot_sha256)`: signer = `Config.rewards_wallet`; coin must be Holders
  mode; pot ≥ `REWARDS_MIN_RELEASE` (D12); ≥ `REWARDS_RUN_MIN_INTERVAL` since the last run; `RewardsRun` is `init` at
  `["rewards_run", mint, rewards_run_count LE]` so an index can neither skip nor replay; whole pot → `ATA(rewards_wallet)`.
  `instructions/lp.rs` `draw_lp(amount)`: signer = `Config.lp_wallet`; `0 < amount ≤ lp_draw_max`; ≥ `lp_draw_interval`
  since `last_lp_draw_ts`; only to `ATA(lp_wallet)`. Nothing else moves `LpPot`.
- Tests: `rewards_lp.test.ts` (11): RewardsRun fields + counter + timestamps, 3599 s refused / 3600 s allowed with
  run_index 1 at a distinct PDA, below-min and empty pot, Wallet-mode coin, admin/LP/treasury/user signers, foreign ATA,
  wrong run index; draw within max + timestamp, above max, zero, 299 s refused / 300 s allowed, every other key and any
  other destination, stolen-key bound.

- Task 6: `instructions/admin.rs` — `AdminConfig` (admin signer + mut Config): `set_split` (validate_split),
  `set_wallets(Option×3)` (never admin, lp_wallet or recovery), `set_pause(bool)`; `AdminCoin`: `set_coin_pause(bool)`
  (SPEC's single `set_pause` is two instructions, global and per-coin); `recover`: coin must be paused, moves the whole
  CoinFee ATA to `ATA(RECOVERY_ADDRESS)` — a constant, so no account arg can redirect it; `SetLp`: signer must equal
  `ProgramData.upgrade_authority_address` of this program (Squads vault on mainnet), caps via validate_lp_params.
- Tests: `admin.test.ts` (15): split change + next settle uses it, bounds, non-admin; wallets partial update, default
  pubkey, non-admin; global pause blocks/unblocks settle, per-coin pause isolates one coin, non-admin; recover requires
  paused, only to recovery ATA (admin's own ATA and treasury refused), non-admin; set_lp by mock multisig (full and
  partial), caps, admin and LP wallet refused, immutable program refused, forged ProgramData refused.

- Task 7: `packages/sdk/src/vault/` — `idl.json` (copied by `scripts/build-vault.sh`), `buildInitialize`,
  `buildDeclareCoin`, `buildSettle`, `buildPayPayee`, `buildRedirectPayee`, `buildSetHolderRewards`, `buildReleaseRewards`,
  `buildDrawLp`, `buildSetSplit`, `buildSetWallets`, `buildSetPause`, `buildSetCoinPause`, `buildRecover`, `buildSetLp`
  (+ `vaultProgramData`), decoders to `types.ts` shapes, `parseVaultEvents`. Admin scripts in `scripts/vault-*.ts` with
  `--dry-run`; `.env.example` lists `DEPLOYER_KEYPAIR`, `ADMIN_KEYPAIR`, `UPGRADE_AUTHORITY_KEYPAIR`, `SATPAD_RECOVERY_ADDRESS`.

- Task 8: `scripts/local-fork.sh` loads the program with `--upgradeable-program` and the dev upgrade-authority key
  (`keys/upgrade-authority-dev.json`, env `VAULT_UPGRADE_AUTHORITY`). Admin scripts exercised on the real validator:
  `initialize` (Config read back with wBTC decimals = 8), `set-split --dry-run`, `set-pause true/false`.
  Verifiable build: blocked on arm64 (D13). `solana-verify` 0.5.2 installed for the amd64 run.
- Task 9: `packages/sdk/src/launch.ts` (`staticAccounts`, `buildV0Transaction`, `createLookupTable`; D14) and
  `scripts/fork-m2-settle.ts`, the definition-of-done script.

## Build hashes (local, deterministic on this machine; Docker-reproducible hash pending D13)
| Build | sha256 | Notes |
| --- | --- | --- |
| `scripts/build-vault.sh` (SBPF **v2**, platform-tools **v1.57**, pinned D15) | `41ad639cf8ec5f17b0de1818deb469a948fda1bca97885341aa8c7b37eaad9cd` (494808 bytes) | passes 66 LiteSVM tests and the M2 DoD on Agave 4.1.2 |
| earlier v2 build with platform-tools v1.54 (499,440 bytes) | `ef615eb5e6337efc4c99754c0a3626b82191cc79eadc7a5b458765955ea67c50` | superseded by the v1.57 pin |
| `SBPF_ARCH=v3 scripts/build-vault.sh` (Anchor default, 467,008 bytes) | `7dbf2f8da59aea471d8ae85a8ec93da872fa1fb034eaa1c2076aafd45658230e` | **do not deploy**: `settle` fails on LiteSVM and on the real validator (D11/V14) |

<!-- ci-hash --> | CI Docker-reproducible (`solanafoundation/solana-verifiable-build:4.1.0`, SBPF v2, commit `7d3bf34`) | `5aa5961e4d8c3b1b49191c3d991828fc324fa4935753b396a1a032fd0afd8bfb` | executable hash `3cd3b56ddb875d5e922e78dcfd001582e8c9773c1d2a158f29075b3340bbdc29` — authoritative once it matches a local build |

## Definition-of-done evidence (local mainnet fork, Agave 4.1.2, v2 build, 2026-10-02)
`scripts/local-fork.sh --detach && pnpm fork:m2`
| Step | Signature / value |
| --- | --- |
| initialize | `5oRXapr9vBLGtZ3gMHgM5p6A7sXxry999mPzN5CuChcvvBPPw4usuxdZFAbg8QtBwQLFBMn96JsPDDfjJ6AeB8Ww` (earlier run) |
| lookup table | 23 static launch accounts |
| launch: create_v2 (creator = CoinFee) + declare_coin + buy_v2, one v0 tx, 1186 bytes | `F9jUNjhTqsWc9WDXMHDaKbEPTvnQr82RwCKawC1PjXHL1RQkey76QErJy17f1ZWrvhaT2dQ5e4c84GbSM8pqkaz` |
| mint / CoinFee | `CEPFpFcyrf6bM9ZcSqNEftoNZPRWqiRFepfbtEx3HKmY` / `HNyBxW5aUy3AF6oHqdKWkz4YaHxJag6YagNMknYGYdzm` |
| launch fee to treasury | 10,000,000 lamports ✓ |
| 3 more buys, then permissionless `collect_creator_fee_v2` | `563rizwerb738DiacXnVZuVSd6mXswYfaS5WnPmkdV8Ne9krRUC1c8PaKYdTdwZerWmG5YuxdjJ26t2yacsKcrES` — 10 sats into the CoinFee ATA |
| settle | `2ajssRLNuvEzJjz95GRTtGnwsd1Aqh43Zs41N7jA6NmmrnZrKZugXvdjEpJHMPAu8yLd6KsPN67xs6R686yJPnVW` — liquidity 3, buyback 2, operator 1, deployer 4 (== `splitFee`, D7 remainder to liquidity) |
| pay_payee | `45g4dFraFeyMgFGvMsEAZqmiW8HQu9BgSaCjR4x1KFkiZdSTBfpZJXWFgyZeV25j8msefFsBr3GXT86sg54TVMSg` — 4 sats to the launcher |
All 10 script checks PASS. Fork signatures are not on a public explorer; re-run to reproduce (new mint each run).

## How to run
```bash
source ~/.cargo/env; export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
pnpm test:vault                                  # scripts/build-vault.sh (anchor build + SBPF v2) + LiteSVM tests
cargo test -p satpad_vault                       # Rust unit tests (bounds)
cargo test -p satpad_vault --features mainnet    # must FAIL until the Squads recovery address is set
```

## Deferred
- Docker-verifiable build hash (D13, amd64 host).
- Root cause of the SBPF v3 failure (V14) — audit scope.
- Production lookup-table address pinned in config (D14, M5).
- `set_lp` on mainnet goes through a Squads proposal (`vault-set-lp.ts --print-ix`); not exercised against a real Squads vault yet (M10).

## Addendum 2026-10-05 (M6 task 3, D21)
- `set_satpad(satpad_mint, satpad_pool, satpad_lp_mint)`: admin-only (`AdminConfig`), write-once (refuses when any field is already set), rejects default/duplicate keys, emits `SatpadSet`. Tests: `tests/vault/admin.test.ts` "set_satpad". Changing the pool afterwards needs an upgrade by the upgrade authority — intended.
- Build note: cargo-build-sbf prints a frame-size estimate warning for `Settle::try_accounts` (AUDIT_SCOPE item 7); all 68 tests pass.

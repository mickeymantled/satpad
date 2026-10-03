# satpad_vault — milestone 2 (in progress)

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

## How to run
```bash
source ~/.cargo/env; export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
pnpm test:vault                                  # scripts/build-vault.sh (anchor build + SBPF v2) + LiteSVM tests
cargo test -p satpad_vault                       # Rust unit tests (bounds)
cargo test -p satpad_vault --features mainnet    # must FAIL until the Squads recovery address is set
```

## Deferred
- Tasks 5–9 (STATUS.md).
- VERIFIED V14: which SBPF version mainnet accepts; task 9 runs the v3 default on the real validator.

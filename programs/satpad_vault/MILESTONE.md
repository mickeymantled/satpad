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

## How to run
```bash
source ~/.cargo/env; export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
pnpm test:vault                                  # anchor build + LiteSVM tests
cargo test -p satpad_vault                       # Rust unit tests (bounds)
cargo test -p satpad_vault --features mainnet    # must FAIL until the Squads recovery address is set
```

## Deferred
- Tasks 2–9 (STATUS.md).

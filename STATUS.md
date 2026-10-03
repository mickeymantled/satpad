# Status

**Current milestone:** 2 — Vault program (M1 approved by human 2026-10-02)
**Last completed step:** M2 task 2 — `declare_coin`: parses pump's `BondingCurve` (`pump.rs`, layout from VERIFIED V3), requires creator == CoinFee, quote == Config.quote_mint, fee bps == Config.creator_fee_bps (D9), no holder-reward/mayhem; creates CoinFee wBTC ATA + PayeePot + RewardsPot; launch fee; admin-only `treasury_only`; `Declared` event. 12 tests (18 total vault).
**Next step:** M2 task 3 — `settle`.
**Blockers:** none. Note for M2 planning: M2's spec DoD says "a devnet coin's creator fee settles four ways" — read as local fork per D1.

## Toolchain (installed 2026-10-02)
Solana/Agave CLI 4.3.0 at `$HOME/.local/share/solana/install/active_release/bin`; Rust 1.99.0 + Anchor CLI 1.2.0 via rustup/avm (`source ~/.cargo/env`); Node 22.22.3; pnpm 11.3.0.

## Milestone 1 — closed 2026-10-02
DoD (DECISIONS D1): coin created on the local mainnet fork with `quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`, by a script. **Met** — see `packages/sdk/MILESTONE.md` for signatures and the 7 on-chain checks.

### Commits
- Kickoff files — `9f4af84`
- Research checkpoint — `d8d9ef7`
- VERIFIED V1–V4, V12 + IDLs — `cb9ba49`
- Local fork + smoke test + DECISIONS D1–D6 + V13 — `ca974bf`
- D2/D3/D5 approvals, SPEC fee table — `4a94ee2`
- Task 1: workspace scaffold — `8e8c361`
- Task 2: quoteMints.ts — `a83c967`
- Task 3: pda.ts — `e27b4e0`
- Task 4: amounts.ts + types.ts — `db6630c`
- Task 5: pump.ts — `22783d1`
- Task 6: scripts/fork-create-and-buy.ts — `68d49b6`
- Task 7: MILESTONE.md evidence, close M1 — (this commit)

### DECISIONS this milestone
D1 local fork target (approved) · D2 pin wBTC (approved) · D3 100 bps + program cap (approved) · D4 no CPI for create_v2 (in effect) · D5 Anchor 1.2 / web3.js v1 (approved) · D6 root tooling (in effect) · D7 split remainder → liquidity (approved) · D8 rewards_run u64 LE (approved)

### Tests added
`packages/sdk/test/{quoteMints,pda,amounts,pump}.test.ts` — 26 tests. Plus two fork scripts that assert on-chain state (`fork-smoke.ts` raw SDK, `fork-create-and-buy.ts` via @satpad/sdk).

### Deferred
See `packages/sdk/MILESTONE.md` "Deferred". Open VERIFIED items: V5–V11.

## Milestone 2 — Vault program (human said "go" 2026-10-02; constants per D9)

**Definition of done (SPEC, read per D1):** on the local fork, a coin's creator fee settles four ways through `satpad_vault`; bankrun suite green; verifiable build hash recorded.

**Constants that need a human value before task 1 (CLAUDE.md hard stops: authorities, recovery address):**
- `RECOVERY_ADDRESS` — spec: "a constant, not a Config field". Proposal for dev/fork: a keypair in `keys/` with its pubkey pinned; mainnet value supplied by you at M10 and compiled into the verifiable build.
- `LP_DRAW_MAX_CAP` — spec: "roughly 0.005 BTC to start". Proposal: `500_000` sats, justified in the code comment as ~$0.5k at $100k/BTC per draw, ≤ 0.1% of a $500k pool per 5-minute interval.
- `MIN_LP_DRAW_INTERVAL = 300`, `REWARDS_RUN_MIN_INTERVAL = 3600`, `MIN_LIQUIDITY_BPS = 2500`, `MAX_OPERATOR_BPS = 2000`, `MAX_CREATOR_FEE_BPS = 100` — from spec / D3, no decision needed.

**Design notes (from VERIFIED V4 / D4):**
- `CoinFee` is a PDA *authority* (`["coin_fee", mint]`, no data) passed to pump as `creator`. Fees are collected by anyone into `ATA(CoinFee, wBTC)`; `settle` CPI-signs as `CoinFee` to split from that ATA. `declare_coin` creates that ATA.
- `declare_coin` reads pump's `BondingCurve` (layout from `idl-ref/pump.json`, `creator` + `quote_mint` + `creator_fee_bps` fields) and refuses unless `creator == CoinFee`, `quote_mint == Config.quote_mint`, `creator_fee_bps == Config.creator_fee_bps` exactly (D9), and `is_holder_reward == false`.
- `$SATPAD` treasury-only flag: `declare_coin(treasury_only: bool)` accepted only when `user == Config.admin`.
- `set_lp` authority = program's upgrade authority, checked via the `ProgramData` account (Anchor `Program`/`ProgramData` constraint); on mainnet that is the Squads vault.
- Split rounding per D7; `rewards_run` index u64 LE per D8; all arithmetic checked, bps via u128.
- Test harness: LiteSVM 1.5 via `tests/vault/harness.ts` (D10). bankrun could not load the SBPF v3 binary.

**Tasks (one commit each, LiteSVM test with every task):**

Done: task 1 — `8a5086f` · task 2 — (this commit)
1. Anchor 1.2 workspace (`Anchor.toml`, `programs/satpad_vault`), constants module, `Config` + `initialize` (bounds-checked split, wallets, quote mint + decimals read from the mint account, creator_fee_bps, launch fee), `Initialized` event. Bankrun harness in `tests/vault/` that loads the `.so`, runs `initialize`, decodes Config with the IDL. SDK: `programs/satpad_vault/idl` → `packages/sdk/src/vault/` generated types + `configPda` wiring.
2. `declare_coin`: `Coin`, `CoinFee` ATA, `PayeePot`, `RewardsPot`; pump `BondingCurve` validation; launch fee transfer; `treasury_only` admin path; `Declared` event. Tests: happy path with a fake BondingCurve account injected into bankrun, refuses second declaration / wrong creator / non-quote mint / fee bps ≠ Config.creator_fee_bps / holder-reward curve / non-admin treasury_only.
3. `settle`: four-way split (D7), treasury_only path, paused refusal (global and per-coin), dust (0 balance) no-op, `Settled` event. Tests: split math at every bound and edge amount (0, 1, 3, 9999, u64::MAX), parity with `@satpad/sdk` `splitFee` across 1,000 random amounts.
4. Payee: `pay_payee` (never creates the ATA; refuses if missing), `redirect_payee`, `set_holder_rewards` (both pay the old payee atomically, only the current payee may call; holders mode permanent). Events `PayeePaid`, `PayeeRedirected`, `HolderRewardsSet`.
5. Rewards + LP: `release_rewards` (needs `RewardsRun` with snapshot hash, ≥ 3600 s since last, pot ≥ min, only to `Config.rewards_wallet`, only signed by it), `draw_lp` (≤ `lp_draw_max`, ≥ interval, only LP wallet), events `RewardsReleased`, `LpDrawn`. Tests include clock warping in bankrun.
6. Admin: `set_split` (bounds), `set_wallets` (never recovery), `set_pause` (global / per-coin), `recover` (paused coin only, to `RECOVERY_ADDRESS` only), `set_lp` (upgrade-authority only, caps). Events `SplitChanged`, `Paused`, `Recovered`. Tests: admin cannot `set_lp`; a mock "multisig" signer as upgrade authority can; nobody but `draw_lp` moves `LpPot`.
7. SDK: `packages/sdk/src/vault/` builders for every instruction + account decoders + event parsers, tests against the generated IDL. `scripts/vault-*.ts` admin scripts with `--dry-run` (initialize, set-split, set-wallets, set-pause, recover, set-lp).
8. Verifiable build: `anchor build --verifiable` (Docker) or `solana-verify build`; record the hash in `programs/satpad_vault/MILESTONE.md`; deploy to the local fork from `scripts/local-fork.sh` (add `--program` load).
9. DoD script `scripts/fork-m2-settle.ts`: create_v2 (creator = CoinFee) + launch fee + `declare_coin` + first buy in **one transaction**, more buys, `collect_creator_fee_v2`, `settle`, then assert the four destination balances match `splitFee`. Record signatures + balances in `MILESTONE.md`; close M2.

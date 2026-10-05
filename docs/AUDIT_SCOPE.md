# Audit scope — satpad_vault

Living document for the M10 audit engagement. Everything the auditors must look at beyond "read the program".

## In scope
- `programs/satpad_vault` — all 14 instructions, bounds in `consts.rs`, authorities (admin hot key vs upgrade authority via `ProgramData`), the fee split (D7 rounding), payee handoffs, rewards release gating, LP draw bounds, recovery to a compile-time constant.
- `packages/sdk` builders (account derivation must match the program), `scripts/vault-*.ts` admin scripts.
- Launch transaction composition (`create_v2` + `declare_coin` + `buy_v2`, v0 + lookup table, D14): can a launch register a coin whose creator is not `CoinFee`, or with a different fee bps?
- Interaction with pump.fun: `declare_coin` trusts the `BondingCurve` layout pinned in `idl-ref/pump.json` (VERIFIED V3); pump upgrades could change it.

## Known findings and constraints to review
1. **SBPF v3 build is broken for this program (D11/D15, V14; upstream anza-xyz/platform-tools#129).** With Anchor 1.2 defaults (`--arch v3`, platform-tools v1.57) and also tools v1.54, `settle`'s account validation fails on LiteSVM and on Agave 4.1.2 (`ConstraintSeeds`/`ConstraintHasOne` with a Pubkey corrupted past byte 8, or an access violation / `ProgramFailedToComplete` depending on frame layout). The v2 build passes 66 LiteSVM tests and the full fee-flow on the real validator. **The deployable artifact is SBPF v2, platform-tools v1.57** (`scripts/build-vault.sh`, CI `verify-build.yml`). Auditors should: (a) confirm the v2 binary executes every instruction correctly on current mainnet runtime; (b) assess whether the v3 miscompile could also silently affect v2 output (same compiler); (c) note that SIMD-0500, if activated, would block v2 upgrades/finalization — the program must be ported to a working v3 build before the upgrade authority is burned.
2. `REWARDS_MIN_RELEASE` is a 1,000-sat constant (D12); the $25 rule is keeper-side.
3. `recover` destination is a compile-time constant selected by cargo feature `mainnet` (D9); the `mainnet` build must be verified to contain the Squads vault address (`cargo test --features mainnet` guard).
4. Residual admin risk (SPEC "Known residual risk"): a stolen admin key can repoint `rewards_wallet` and drain rewards pots one run per coin per hour.
5. Anchor 1.x duplicate-mutable-account check: `settle`/`recover` refuse when two destination wallets share an ATA — operationally the wallets must be distinct.

6. `set_satpad` (D21, M6): admin-only and write-once — refuses once any of `satpad_mint`/`satpad_pool`/`satpad_lp_mint` is set, rejects default or duplicate keys, emits `SatpadSet`. The keeper's LP and buyback loops trust these three addresses; changing them after bootstrap requires a program upgrade by the Squads authority, which is the intended control.

7. **Stack frame overflow in `Settle::try_accounts` — resolved 2026-10-05, same root cause as item 1.** `Settle` now validates the three wallet/PDA quote accounts by `token::mint` + `token::authority` instead of deriving ATAs, and boxes its token, mint, `Config` and `Coin` accounts; the frame warning is gone, and the SBPF v3 build passes the full suite and the fork DoD. Security note for the auditor: any quote token account *owned* by `Config.treasury` / `Config.buyback_wallet` / the CoinFee PDA is accepted (the keeper passes the ATAs); funds can only ever reach those owners. Original observation kept below. **Stack frame estimate on `Settle::try_accounts`** (observed 2026-10-05, platform-tools v1.57, SBPF v2): `cargo-build-sbf` reports "overflows the maximum allowed frame space … offset 704 bytes greater than the maximum of 4096; estimated frame 4800 bytes". The instruction is unchanged since M2 and every `settle` test (LiteSVM) and fork settle (M3 soak) passes, so it is most likely Anchor's conservative estimate for a large `#[derive(Accounts)]` struct, but it must be confirmed (box the largest accounts in `Settle` if real). Not yet established whether earlier builds printed it; CI's container output does not show linker diagnostics.

8. **Buyback wallet is a keeper hot key (D22, approved).** Mitigations: the loop spends the whole balance every 300 s; alert when the balance exceeds the last hour's settled buyback share. **v2 candidate:** a vault-owned `BuybackPot` and an in-program `buyback` instruction (CPI PumpSwap buy + burn) so no hot key holds BTC.

## Out of scope
pump.fun / PumpSwap programs (external, unmodified), NEAR Intents bridge (client-side only), keeper/indexer/web services (separate review).

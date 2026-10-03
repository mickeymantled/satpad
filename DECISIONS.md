# Decisions

Append-only log of deviations from SPEC.md and proposals. Each entry: date, milestone, decision, reason, status (proposed / approved by human).

## D1 — 2026-10-02 — M1 — Milestone 1 targets a local mainnet fork, not devnet
**Decision (human, 2026-10-02):** M1 definition of done becomes "a coin created on a local `solana-test-validator` fork of mainnet with `quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`." Spec text says devnet.
**Reason:** Devnet pump.fun has an uninitialized QuoteControl and `creator_fee_configurable = false` (VERIFIED V12); only pump's admin can add a quote mint. Mainnet already has 3,406 wBTC-quoted curves, so a fork of mainnet state is the faithful test target.
**Evidence:** `scripts/local-fork.sh` + `scripts/fork-smoke.ts`, green on 2026-10-02 (VERIFIED V13). Clone list proven by ablation: `create_v2` needs pump program + Global + QuoteControl + the wBTC mint (fails 6075 `InvalidQuoteControl` without QuoteControl); `buy_v2` additionally needs pump_fees program + `fee_config` + `global_volume_accumulator`. Mayhem program is CPI'd by `create_v2` even with `is_mayhem_mode=false`; mayhem `global_params`/`sol_vault`, `event_authority`, and fee-recipient accounts are cloned but not strictly required.
**Follow-on:** Later milestones' "devnet" DoDs (M2, M3, M4, M5, M6, M7) should be read as "local fork" unless pump enables Custom Pairs on devnet; re-check V12 at each milestone close.
**Status:** approved by human.

## D2 — 2026-10-02 — M1 — BTC quote mint pinned to Wormhole wBTC `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh` (8 decimals)
**Decision:** `BTC_QUOTE_MINT = 3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh`, `BTC_QUOTE_DECIMALS = 8`.
**Reason:** It is the only BTC mint in pump's QuoteControl on mainnet (VERIFIED V1). Spec hard-dependency "the BTC wrapper's issuer stays solvent" therefore means Wormhole/Portal, not Coinbase cbBTC or Zeus zBTC.
**Status:** approved by human 2026-10-02. Issuer risk = BitGo + Wormhole (see VERIFIED V1).

## D3 — 2026-10-02 — M1 — Creator fee default 100 bps; on-chain cap is 300 bps
**Decision:** Pass `creator_fee_bps = 100` (1.00%) to `create_v2`. Spec table assumes 2.00% and says "maximum pump.fun allows." The on-chain maximum is 300 bps (VERIFIED V2), but pump.fun's FAQ and create form market 0.05%–1%, and the docs say creator-fee changes on custom pairs go through pump's CTO team.
**Reason:** 300 bps is technically accepted by the program but is 3× the published ceiling; a coin advertised above the public range risks pump.fun intervention or a UI mismatch on pump.fun's own site. 100 bps is the top of the published range. Per-trade percentages shown to users are the spec's "halve the per-trade percentages" case: Liquidity 0.25%, Buyback 0.25%, Operator 0.10%, Deployer 0.40% of trade. Bps split of the fee is unchanged.
**Status:** approved by human 2026-10-02 at **100 bps**, with two additions: (a) `creator_fee_bps` becomes a `Config` field in `satpad_vault` with a program-enforced ceiling `MAX_CREATOR_FEE_BPS = 100` (a constant, so raising it needs an upgrade through the Squads multisig); (b) SPEC.md's fee table updated by human direction to the halved per-trade numbers — Liquidity 0.25%, Buyback 0.25%, Operator 0.10%, Deployer 0.40% — bps split of the fee unchanged. SDK default lives in `packages/sdk/src/quoteMints.ts` and must equal the program constant (test asserts it).

## D4 — 2026-10-02 — M1 — `create_v2` does not need a CPI from `satpad_vault`
**Decision:** The launch transaction calls `create_v2` directly from the user's wallet with `creator = CoinFee PDA` as a plain argument; `declare_coin` runs after it in the same transaction and verifies `bonding_curve.creator == CoinFee`. No CPI from the vault into pump.
**Reason:** `create_v2.creator` is a non-signing Pubkey arg and fee collection is permissionless (VERIFIED V4). Spec's `declare_coin` check "pump.fun bonding curve's creator fee recipient is `CoinFee`" maps to `bonding_curve.creator`. The spec's "creator fee recipient set to the coin's `CoinFee` PDA" is satisfied this way. `declare_coin` must also create `CoinFee`'s wBTC ATA (off-curve owner) so collects can land.
**Status:** approved in effect (no spec deviation; clarifies mechanism). Flagged here because the spec's account table should say "creator" rather than "fee recipient".

## D5 — 2026-10-02 — M1 — Toolchain versions differ from spec text
**Decision:** Anchor CLI 1.2.0 (spec: "0.30+"), Rust 1.99.0, Solana/Agave 4.3.0, pump-sdk 2.0.0 + pump-swap-sdk 1.20.0 which depend on `@solana/web3.js` v1 and `@coral-xyz/anchor` 0.31 (spec: `@solana/kit` for RPC). SDK package uses web3.js v1 to match pump's SDKs; `@solana/kit` deferred — adopt only if a later milestone needs it, to avoid a dual RPC stack.
**Reason:** Latest stable at install time; pump SDKs dictate web3.js v1.
**Status:** approved by human 2026-10-02. **SPEC.md's "Anchor 0.30+" and "`@solana/kit` for RPC" lines are superseded: Anchor 1.2.0 and `@solana/web3.js` v1 everywhere.**

## D6 — 2026-10-02 — M1 — Root tooling added for the fork smoke test before the full monorepo scaffold
**Decision:** Root `package.json` (private, pnpm 11.3.0, CJS — `@coral-xyz/anchor` fails to import its `BN` under ESM via tsx), `tsconfig.json` strict, `pnpm-workspace.yaml`, and `scripts/fork-*.ts`. Task 1 of the M1 plan (full workspace scaffold) will build on these rather than replace them.
**Status:** approved in effect (tooling only).

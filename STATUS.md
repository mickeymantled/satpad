# Status

**Current milestone:** 1 — Repo and SDK
**Last completed step:** Task 4 — `amounts.ts` (branded `Sats`, `parseBtc`/`toUi` exact at 8 decimals, `applyBps`, `splitFee` with remainder to deployer, `assertValidSplit` with spec bounds) + `types.ts` (Config, Coin, RewardsRun, PayeeMode, Stage); 9 tests. Dev program id `52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93` (keypair `keys/satpad_vault-dev.json`, gitignored).
**Next step:** Task 5 — pump.fun v2 wrappers in `packages/sdk/src/pump.ts`.
**Blockers:** none.

## Milestone 1 definition of done (per DECISIONS D1)
A coin created on the local mainnet fork (`scripts/local-fork.sh`) with `quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`, by a script in the repo.
Current evidence: `scripts/fork-smoke.ts` already does this against the raw pump-sdk. M1 closes when the same flow runs through `packages/sdk` wrappers (plan tasks 5–7).

## Toolchain (installed 2026-10-02)
Solana/Agave CLI 4.3.0 at `$HOME/.local/share/solana/install/active_release/bin`; Rust 1.99.0 + Anchor CLI 1.2.0 via rustup/avm (`source ~/.cargo/env`); Node 22.22.3; pnpm 11.3.0.

## Plan (milestone 1, human said "go" 2026-10-02)
1. Monorepo scaffold on top of the existing root `package.json`: pnpm workspaces (`packages/*`, `keeper`, `indexer`, `api`, `web`, `scripts`), TS strict, vitest, eslint, `.env.example`, directory skeleton per SPEC layout, `pnpm test` at root
2. `packages/sdk`: `quoteMints.ts` with `BTC_QUOTE_MINT`, `BTC_QUOTE_DECIMALS = 8`, `DEFAULT_CREATOR_FEE_BPS = 100`, `MAX_CREATOR_FEE_BPS = 100` (must match program constant) — D2/D3 approved
3. `packages/sdk`: `satpad_vault` program id placeholder + PDA derivations (`config`, `coin_fee`, `coin`, `payee_pot`, `rewards_pot`, `lp_pot`, `rewards_run`) with vitest tests
4. `packages/sdk`: Config / Coin TypeScript types and bigint amount helpers (base units ↔ sats ↔ ui string, 8 decimals) with tests
5. `packages/sdk`: pump.fun v2 wrappers — `buildCreateV2`, `buildBuyV2`, `buildSellV2`, `buildCollectCreatorFeeV2` pinned to the quote mint, wrapping `@pump-fun/pump-sdk` 2.0.0; tests assert account lists against `idl-ref/pump.json`
6. `scripts/fork-create-and-buy.ts` with `--dry-run`: M1 DoD script using the `packages/sdk` wrappers against the local fork (supersedes `fork-smoke.ts`, which stays as the raw-SDK reference)
7. Run it, record signatures in `packages/sdk/MILESTONE.md` as DoD evidence

## Done
- Kickoff files — `9f4af84`
- Research checkpoint — `d8d9ef7`
- VERIFIED V1–V4, V12 + IDLs — `cb9ba49`
- Local fork + smoke test + DECISIONS D1–D6 + V13 — `ca974bf`
- D2/D3/D5 approvals, SPEC fee table — `4a94ee2`
- Task 1: workspace scaffold — `8e8c361`
- Task 2: quoteMints.ts — `a83c967`
- Task 3: pda.ts — `e27b4e0`
- Task 4: amounts.ts + types.ts — (this commit)

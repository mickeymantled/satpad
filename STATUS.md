# Status

**Current milestone:** 1 — Repo and SDK
**Last completed step:** Local mainnet fork proven: `create_v2` (wBTC quote, PDA-style non-signing creator, 100 bps) + `buy_v2` green. VERIFIED V1–V4, V12, V13 recorded. DECISIONS D1–D6 written.
**Next step:** Human review of DECISIONS D2 (pin wBTC mint), D3 (creator fee 100 vs 300 bps), D5 (toolchain). Then plan task 1 (workspace scaffold).
**Blockers:** D2 sign-off required by CLAUDE.md before `packages/sdk/src/quoteMints.ts` can be written (plan task 2). Tasks 1, 3, 4 do not depend on it.

## Milestone 1 definition of done (per DECISIONS D1)
A coin created on the local mainnet fork (`scripts/local-fork.sh`) with `quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`, by a script in the repo.
Current evidence: `scripts/fork-smoke.ts` already does this against the raw pump-sdk. M1 closes when the same flow runs through `packages/sdk` wrappers (plan tasks 5–7).

## Toolchain (installed 2026-10-02)
Solana/Agave CLI 4.3.0 at `$HOME/.local/share/solana/install/active_release/bin`; Rust 1.99.0 + Anchor CLI 1.2.0 via rustup/avm (`source ~/.cargo/env`); Node 22.22.3; pnpm 11.3.0.

## Plan (milestone 1, confirmed by human decision 2026-10-02 for the fork target; tasks below still awaiting "go")
1. Monorepo scaffold on top of the existing root `package.json`: pnpm workspaces (`packages/*`, `keeper`, `indexer`, `api`, `web`, `scripts`), TS strict, vitest, eslint, `.env.example`, directory skeleton per SPEC layout, `pnpm test` at root
2. `packages/sdk`: `quoteMints.ts` with `BTC_QUOTE_MINT`, `BTC_QUOTE_DECIMALS = 8`, `DEFAULT_CREATOR_FEE_BPS` — **blocked on D2/D3 sign-off**
3. `packages/sdk`: `satpad_vault` program id placeholder + PDA derivations (`config`, `coin_fee`, `coin`, `payee_pot`, `rewards_pot`, `lp_pot`, `rewards_run`) with vitest tests
4. `packages/sdk`: Config / Coin TypeScript types and bigint amount helpers (base units ↔ sats ↔ ui string, 8 decimals) with tests
5. `packages/sdk`: pump.fun v2 wrappers — `buildCreateV2`, `buildBuyV2`, `buildSellV2`, `buildCollectCreatorFeeV2` pinned to the quote mint, wrapping `@pump-fun/pump-sdk` 2.0.0; tests assert account lists against `idl-ref/pump.json`
6. `scripts/fork-create-and-buy.ts` with `--dry-run`: M1 DoD script using the `packages/sdk` wrappers against the local fork (supersedes `fork-smoke.ts`, which stays as the raw-SDK reference)
7. Run it, record signatures in `packages/sdk/MILESTONE.md` as DoD evidence

## Done
- Kickoff files — `9f4af84`
- Research checkpoint — `d8d9ef7`
- VERIFIED V1–V4, V12 + IDLs — `cb9ba49`
- Local fork + smoke test + DECISIONS D1–D6 + V13 — (this commit)

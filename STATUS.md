# Status

**Current milestone:** 2 — Vault program (awaiting human review of M1 close before planning)
**Last completed step:** Milestone 1 closed. Definition of done met on the local mainnet fork via `pnpm fork:m1`; evidence in `packages/sdk/MILESTONE.md`. 26 sdk tests, typecheck and lint green.
**Next step:** Human runs the review gate for M1 (WORKFLOW.md). Then: plan M2 — `programs/satpad_vault` Anchor 1.2 program with all instructions, bounds, events; bankrun tests; verifiable build. Re-check VERIFIED V12 (devnet Custom Pairs) at M2 close.
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
D1 local fork target (approved) · D2 pin wBTC (approved) · D3 100 bps + program cap (approved) · D4 no CPI for create_v2 (in effect) · D5 Anchor 1.2 / web3.js v1 (approved) · D6 root tooling (in effect)

### Tests added
`packages/sdk/test/{quoteMints,pda,amounts,pump}.test.ts` — 26 tests. Plus two fork scripts that assert on-chain state (`fork-smoke.ts` raw SDK, `fork-create-and-buy.ts` via @satpad/sdk).

### Deferred
See `packages/sdk/MILESTONE.md` "Deferred". Open VERIFIED items: V5–V11.

## Milestone 2 plan
(to be written after M1 review)

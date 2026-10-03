# Status

**Current milestone:** 3 — Keeper, claim and settle loop (M2 approved by human 2026-10-02; M3 code BLOCKED on the V14 investigation, one session, then plan)
**Last completed step:** Milestone 2 closed (provisionally, D13). Definition of done met on the local mainnet fork with the SBPF v2 build via `pnpm fork:m2`; evidence in `programs/satpad_vault/MILESTONE.md`. 66 program tests, 39 sdk tests, cargo tests, typecheck, lint green.
**Next step:** (1) CI workflow for solana-verify on amd64 (D13 as revised); (2) V14 in order: mainnet acceptance of SBPF v2 → minimal repro on v2/v3 → upstream issue + pin toolchain → audit scope. Then M3 plan.
**Blockers:** Verifiable build cannot run on this arm64 machine (D13). SBPF v3 build of the program is broken on both LiteSVM and Agave 4.3 — v2 is the only deployable build until the cause is found (D11 correction, V14).

## Toolchain (installed 2026-10-02)
Solana/Agave CLI 4.3.0 at `$HOME/.local/share/solana/install/active_release/bin`; Rust 1.99.0 + Anchor CLI 1.2.0 via rustup/avm (`source ~/.cargo/env`); `solana-verify` 0.5.2; Node 22.22.3; pnpm 11.3.0; Docker 29.8 (arm64 — no amd64 verifiable image runs).
Dev keys (all gitignored under `keys/`): `satpad_vault-dev.json` (program id `52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93`), `recovery-dev.json` (`CTsAbZqVBmfb2NgUr8BJ9CUCmj1vMqrR3kWA8k6Wcmog`), `upgrade-authority-dev.json` (`U3CGV1FvYBnHDf9CNmEwEMW97CXE1BWo1pK7QqvNKav`), `deployer-dev.json`, `admin-dev.json`.

## Milestone 1 — closed 2026-10-02 (human approved)
See `packages/sdk/MILESTONE.md`. Commits `9f4af84` … `2ab222d`.

## Milestone 2 — closed 2026-10-02 (pending review)
DoD (SPEC, per D1): a coin's creator fee settles four ways through `satpad_vault` on the fork; LiteSVM suite green; verifiable build hash recorded (local hash recorded; Docker hash deferred, D13). **Met** except the Docker hash.

### Commits
- D9 constants — `(see log)` · task 1 scaffold + Config + initialize — `8a5086f` · task 2 declare_coin — `1bebe2c` · task 3 settle — `c296453` · task 4 payee — `d85423a` · task 5 rewards + LP — `f71f35e` · task 6 admin — `99829cb` · task 7 SDK + scripts — `2d39c90`, `c1ed409` · task 8 fork load + hashes — `23c9165` · task 9 launch ALT + DoD — `04197bb`

### DECISIONS this milestone
D9 constants/gates (approved) · D10 LiteSVM harness (in effect) · D11 SBPF v2 builds — **corrected: v3 is broken on the real validator too** (in effect) · D12 `REWARDS_MIN_RELEASE` (proposed) · D13 verifiable build deferred to amd64 (proposed) · D14 launch v0 + lookup table (in effect)

### Tests added
`tests/vault/{initialize,declare_coin,settle,payee,rewards_lp,admin}.test.ts` — 66 LiteSVM tests covering every SPEC "Program tests" bullet: split math at every bound, declaration refusals, atomic payee payouts, draw_lp caps/interval/signer, release_rewards hash-first/hourly/wallet, recover paused-only/fixed address, admin cannot set_lp while a mock multisig can. Rust unit tests for split/bounds and the mainnet recovery-address guard. `packages/sdk/test/{vault,launch}.test.ts` — 13 tests. `scripts/fork-m2-settle.ts` — 10 on-chain checks.

### Deferred
See `programs/satpad_vault/MILESTONE.md` "Deferred". Open VERIFIED items: V5–V11, V14 (partial).

## Milestone 3 plan
(to be written after M2 review)

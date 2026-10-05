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
**Decision:** Anchor CLI 1.2.0 (spec: "0.30+"), Rust 1.99.0, Solana/Agave 4.1.2, pump-sdk 2.0.0 + pump-swap-sdk 1.20.0 which depend on `@solana/web3.js` v1 and `@coral-xyz/anchor` 0.31 (spec: `@solana/kit` for RPC). SDK package uses web3.js v1 to match pump's SDKs; `@solana/kit` deferred — adopt only if a later milestone needs it, to avoid a dual RPC stack.
**Reason:** Latest stable at install time; pump SDKs dictate web3.js v1.
**Status:** approved by human 2026-10-02. **SPEC.md's "Anchor 0.30+" and "`@solana/kit` for RPC" lines are superseded: Anchor 1.2.0 and `@solana/web3.js` v1 everywhere.**

## D6 — 2026-10-02 — M1 — Root tooling added for the fork smoke test before the full monorepo scaffold
**Decision:** Root `package.json` (private, pnpm 11.3.0, CJS — `@coral-xyz/anchor` fails to import its `BN` under ESM via tsx), `tsconfig.json` strict, `pnpm-workspace.yaml`, and `scripts/fork-*.ts`. Task 1 of the M1 plan (full workspace scaffold) will build on these rather than replace them.
**Status:** approved in effect (tooling only).

## D7 — 2026-10-02 — M1→M2 — Fee-split rounding remainder goes to the liquidity share
**Decision (human):** In `settle` (and `@satpad/sdk` `splitFee`), buyback, operator and deployer shares are floored `amount * bps / 10000`; liquidity = amount − the other three. The remainder (up to 3 base units) therefore always lands in `LpPot`, so the 2500 bps liquidity floor holds exactly at every amount. Earlier SDK draft gave the remainder to the deployer; reversed.
**Status:** approved by human 2026-10-02. Program must mirror; bankrun test asserts `liquidity ≥ floor(amount·2500/10000)` across edge amounts.

## D8 — 2026-10-02 — M1 — `rewards_run` PDA index encoded as u64 little-endian
**Decision:** `["rewards_run", mint, run_index.to_le_bytes()]` with `run_index: u64`. Spec left the encoding unspecified.
**Status:** approved by human 2026-10-02.

## D9 — 2026-10-02 — M2 — Constants and gates for satpad_vault (human-approved before task 1)
- `RECOVERY_ADDRESS`: single `consts.rs`, selected by cargo feature — `fork` (dev keypair in `keys/`, pinned pubkey) vs `mainnet` (the Squads vault address, supplied at M10). A build-time test refuses a `mainnet` build whose recovery address equals any dev key.
- `LP_DRAW_MAX_CAP = 500_000` sats (0.005 BTC) per draw.
- `declare_coin` requires the curve's `creator_fee_bps == Config.creator_fee_bps` exactly (not ≤ cap). Every registered coin pays the same fee or it is not registered.
- LiteSVM pre-approved as the bankrun fallback if bankrun cannot load an Anchor 1.2 binary (test dep only).
**Status:** approved by human 2026-10-02.

## D10 — 2026-10-02 — M2 — Program tests run on LiteSVM 1.5 (kit-typed) through a web3.js shim; bankrun dropped
**Decision:** `solana-bankrun` 0.4.0 (last published 2024-10, bundles solana-program-test 1.18) hangs/panics loading the Anchor 1.2 binary (SBPF v3). LiteSVM 0.8 (last web3.js-v1 line) rejects the ELF too. LiteSVM 1.5.0 (2026-09) loads it but is typed against `@solana/kit`. `tests/vault/harness.ts` builds transactions with web3.js v1 and decodes them into kit's wire type with `getTransactionDecoder()`; tests never touch kit. `@solana/kit` is a test-only dependency.
**Reason:** D9 pre-approved LiteSVM as the fallback. Keeping web3.js v1 in tests keeps `@satpad/sdk` helpers usable there.
**Consequence:** CLAUDE.md "Anchor tests use bankrun" → read as LiteSVM. `pnpm test:vault` runs `anchor build` first because tests load `target/deploy/*.so` and `target/idl/*.json` (gitignored).
**Status:** in effect (covered by D9 approval).

## D11 — 2026-10-02 — M2 — Program tests run against an SBPF v2 build; Anchor 1.2 defaults to v3
**Finding:** With the identical source, the LiteSVM 1.5 suite passes 28/28 on SBPF v1 and v2 builds and fails on v3 (and v0) with corrupted stack temporaries (a `Pubkey` garbage past byte 8 in a seeds check; an access violation in `settle`). anchor-syn 1.2's constraint codegen was read and is inline, so the program's `mint.key().as_ref()` idiom is sound.
**Correction (task 9, 2026-10-02):** the v3 binary shows the *same* `ConstraintSeeds`/`ConstraintHasOne` corruption on the real `solana-test-validator` 4.3 (`settle` after a successful launch), while the v2 binary passes the full M2 definition of done there. So this is not a LiteSVM bug: Anchor 1.2 + platform-tools' SBPF **v3** output of this program is miscompiled or hits a runtime bug. Until the cause is found, every build is **v2** (`scripts/build-vault.sh` default); V14 and the audit scope (M10) must cover it. `initialize`/`set_split`/`set_pause` happened to work on v3 — the failure needs a `has_one`/`seeds` constraint reading an `UncheckedAccount` key.
**Decision:** `scripts/build-vault.sh` = `anchor build` (IDL) + `cargo build-sbf --arch v2`. `pnpm test:vault` uses it. Task 9 (DoD on the real `solana-test-validator` 4.3 fork) must also run once with `SBPF_ARCH=v3` so the default binary is exercised on the real runtime. Which SBPF version mainnet accepts for deploy is VERIFIED V14 (open) and decides the M10 build arch.
**Status:** in effect (test-infrastructure choice; no spec deviation).

## D12 — 2026-10-02 — M2 — `release_rewards` "pot above min" is a program constant `REWARDS_MIN_RELEASE = 1_000` sats
**Decision:** SPEC lists "pot above min" as a `release_rewards` requirement but defines the $25 (Pyth) threshold only on the keeper side. The program cannot read USD, so it enforces a fixed dust guard of 1,000 base units (~$1 at $100k/BTC); the keeper applies the $25 rule before calling. Raising the constant is a program upgrade.
**Status:** approved by human 2026-10-02 (1,000 sats).

## D13 — 2026-10-02 — M2 — Verifiable build deferred to an amd64 host; local build hashes recorded
**Finding:** `anchor build --verifiable` uses `quay.io/ottersec/anchor:v1.2.0`, which has no arm64 manifest; under `DOCKER_DEFAULT_PLATFORM=linux/amd64` the container never started on this Apple Silicon machine. `solana-verify` (installed, v0.5.2) needs the same kind of image.
**Decision:** M2's "verifiable build hash recorded" is satisfied provisionally with the local deterministic build hash in `programs/satpad_vault/MILESTONE.md`; the Docker-reproducible hash is produced on an amd64 host (CI runner or Linux box) at M10, where SPEC places "Verified build published". Until then no mainnet deploy anyway.
**Status:** rejected by human 2026-10-02 — do not defer. Instead: GitHub Actions workflow on push to `main` runs `solana-verify` on an ubuntu amd64 runner, uploads the hash as a build artifact and records it in MILESTONE.md. The local v2 hash is the fallback reference until CI's first green run.

## D14 — 2026-10-02 — M2 — Launch is a v0 transaction with a lookup table of launch-static accounts
**Finding:** `create_v2` + `declare_coin` + `buy_v2` is ~1770 bytes legacy; the limit is 1232. SPEC anticipates this ("use an address lookup table").
**Decision:** `@satpad/sdk` `staticAccounts()` derives the accounts common to every launch (pump globals, fee config, programs, quote mint, vault Config, fee recipients — 23 entries) and `buildV0Transaction()` compiles a v0 message with that table: launch = 1186 bytes, one atomic transaction, per-mint and per-user accounts inline. The fork creates the table per run; **production creates it once and pins its address** (env `SATPAD_LAUNCH_ALT`, M5). If pump.fun changes its fee recipients the table must be extended.
**Status:** in effect (mechanism the spec names).

## D15 — 2026-10-03 — M2/M3 gate — SBPF v3 investigation result; toolchain pinned
**Step 1 (mainnet acceptance):** an SBPF v2 `.so` IS accepted on mainnet-beta today for deploy and upgrade: `enable_sbpf_v2_deployment_and_execution` (`F6UVKh1ujTEFK3en2SyAL3cdVnqko1FVEXWhmdLRu6WP`) active since slot 356,400,000; the only thing that would stop it, SIMD-0500 `disable_sbpf_v0_v1_v2_deployment` (`B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`), is a draft with no feature account on mainnet or devnet. Risk: if SIMD-0500 activates later, a v2 program keeps executing but can no longer be upgraded or finalized without moving to v3 — the v3 bug must be resolved before the upgrade authority is burned. Sources in VERIFIED V14.
**Step 2 (repro):** `programs/sbpf_repro` + `scripts/repro-sbpf.ts`. Minimal shapes (seeds + stored bump + `has_one` on an `UncheckedAccount` key; Signer variant; manual check; 10 extra accounts; 6 `InterfaceAccount<TokenAccount>` with 3 `associated_token` constraints) all PASS under v3 on the real validator. The full `satpad_vault::settle` account struct FAILS under v3 with **both** platform-tools v1.54 (`ProgramFailedToComplete`) and v1.57 (`ConstraintSeeds` on `coin`, key corrupted past byte 8), and PASSES under v2 with both. Bisecting `Settle` on v3: a no-op handler still fails (so it is account validation); dropping either of the two `associated_token::authority = config.<field>` ATA constraints makes the `coin` check pass but a different constraint then fails; replacing the field-path authorities with explicit accounts turns it into an access violation. The fault moves with the frame layout → a v3-specific stack/codegen or VM defect in large `try_accounts` frames with multiple ATA derivations (`find_program_address` syscalls). Same behaviour on LiteSVM 1.5 and Agave 4.1.2 `solana-test-validator`, so the common layer is the SBPF v3 program itself (compiler output) or the shared sbpf VM; not anchor-syn's seeds expansion (same expansion works on v2) and not platform-tools version.
**Layer at fault:** platform-tools (LLVM SBPF v3 backend) or the sbpf VM's v3 execution — not separable with the evidence in hand. Related: anza-xyz/platform-tools#114 "Corrupted reference constants" (constant bytes zeroed at 4-byte offsets, v1.47/v1.54).
**Step 3 (upstream):** filed 2026-10-03 as **https://github.com/anza-xyz/platform-tools/issues/129** (text in `docs/upstream/sbpf-v3-settle-corruption.md`, cross-referencing #114; this public repo at `fe7b16a` is the reproduction).
**Toolchain pin:** Anchor 1.2.0; cargo-build-sbf 4.1.0 (Agave CLI 4.1.2 — earlier docs said 4.3.0 in error); platform-tools **v1.57** (Anchor's default, now explicit in `scripts/build-vault.sh` and CI); rustc 1.89; deployable arch **SBPF v2**. LiteSVM suite 66/66 and the M2 DoD on the real validator pass with v1.57 + v2.
**Step 4:** finding and pin recorded in `docs/AUDIT_SCOPE.md`.
**Status:** in effect; upstream issue anza-xyz/platform-tools#129 open.

## D16 — 2026-10-03 — M4 — HTTP/WebSocket framework for the API: Fastify + @fastify/websocket + @fastify/rate-limit
**Decision:** SPEC names "REST + WebSocket" and rate limiting without a library; Node 22 has no WebSocket server. Fastify with its official websocket and rate-limit plugins is the only new runtime dependency family for `api/`.
**Status:** approved by human 2026-10-03.

## D17 — 2026-10-03 — M5 — SOL→BTC auto-swap: Jupiter in production, dev-only faucet swap on the fork
**Decision:** Jupiter v6 quote → swap transaction → client-side simulation → sign in production (V10). On the fork, where Jupiter cannot execute, a dev-only faucet swap (SOL → wBTC at a fixed rate via the fork's patched mint authority) behind `NEXT_PUBLIC_DEV_SWAP=1`. **Human requirement:** the faucet module must be tree-shaken out of production builds, not merely runtime-gated; a build check greps the production bundle for the dev-swap module name and fails if present.
**Status:** approved by human 2026-10-03.

## D18 — 2026-10-03 — M5 — Coin metadata: pump.fun IPFS upload primary (if V16 confirms), Postgres `POST /metadata` fallback
**Decision (human):** run V16 first. If pump.fun's IPFS upload endpoint accepts third-party coins, use it as primary so the metadata URI is what explorers and pump.fun expect and survives Satpad downtime; keep the API's Postgres-backed `POST /metadata` as fallback and as the fork path. Which backend is active is recorded in runtime config (API `GET /config`, env `METADATA_BACKEND=pump|api`), not hardcoded. (Interpretation: "Config" = runtime config served by the API, not the on-chain `Config` account, which has no such field.)
**Status:** approved by human 2026-10-03. V16 result: pump.fun's endpoint works unauthenticated but is undocumented, server-side only (no CORS) and reportedly unsupported → it is the primary backend (`METADATA_BACKEND=pump`), called by the API on the launcher's behalf, with automatic fallback to the Postgres backend on any non-200; the fork uses `METADATA_BACKEND=api`. The API's `GET /config` reports the active backend. Stored `uri` for the pump backend is the returned `metadataUri` verbatim.

## D19 — 2026-10-03 — M5 — Web dependencies approved
`next@15`, `react@19`, `@solana/wallet-adapter-{base,react,react-ui,wallets}`, `tailwindcss`, `lightweight-charts` (human: a hand-rolled chart is not worth maintaining), `@playwright/test` for e2e.
**Status:** approved by human 2026-10-03.

## D20 — 2026-10-03 — M5 — Launch size: priority fee dropped first, then the first buy as a second transaction; the SOL swap is never composed
**Finding:** over the launch lookup table (D14), create_v2 + declare_coin + first buy with the compute-budget pair measured 925 bytes without a first buy, 1251 with one (Holders payee) and 1283 (Wallet payee) using a 32-byte name, a 10-character symbol and a 52-character metadata URI — pump.fun IPFS URIs are 67 characters, so a maximal launch with a first buy does not fit 1232 bytes. A Jupiter swap alone is 840–949 bytes with 3 tables (V10), so SPEC's "inside the same transaction when size allows" never allows.
**Decision:** `web/lib/launch.ts` `planLaunch` tries, in order: one transaction with priority fee → one transaction without the priority-fee instruction (SPEC "launch-with-first-buy may run without one when near the size limit") → create_v2 + declare_coin alone (always atomic, as SPEC requires), then the first buy as a second transaction sent right after the launch confirms, each with its own preview. The SOL → BTC swap always runs as its own prior transaction and the launch waits for its confirmation (SPEC allows this). The UI states which mode applies before the wallet prompt.
**Status:** approved by human 2026-10-04 with one condition: the UI must say plainly, before the wallet prompt, that the first buy will be a second transaction and that the launch itself (create + fee + declare) stays atomic — never a silent split. Implemented: the notice is shown in the form and inside the preview modal of both transactions. Shrinking the inline footprint (shorter fallback metadata ids, moving more accounts into the table) could bring the common case back to one transaction; worth revisiting before mainnet.

## D21 — 2026-10-04 — M6 — `set_satpad`: admin-only, write-once pool registration
**Decision (human):** add `set_satpad(satpad_mint, satpad_pool, satpad_lp_mint)` to `satpad_vault`, admin-only and write-once: it refuses if any of the three Config fields is already set, emits a `SatpadSet` event, gets its own LiteSVM tests and a line in `docs/AUDIT_SCOPE.md`. Changing the pool afterwards requires a program upgrade — by design. `@pump-fun/pump-swap-sdk@1.20.0` approved for `packages/sdk`.
**Status:** approved by human 2026-10-04; implementation in M6 task 3.

## D22 — 2026-10-05 — M6 — The buyback wallet is a keeper hot key
**Finding:** SPEC's buyback loop "swaps the buyback wallet's BTC balance for $SATPAD on the pool and burns it", but the keeper's key table lists three hot keys (keeper, LP, rewards). The swap must be signed by the wallet that owns the BTC, so the keeper holds the buyback wallet's key as a fourth hot key (`BUYBACK_WALLET_KEYPAIR`). Blast radius: a stolen key can at most buy and burn (or, with a modified keeper, keep) one interval's worth of settled buyback share — `settle` keeps sending the 25% share there, and the admin can repoint `buyback_wallet` via `set_wallets`.
**Decision:** proposed. Alternative for later: a vault-owned `BuybackPot` plus a `buyback` instruction that CPIs the PumpSwap buy and burns in-program, so no hot key holds BTC.
**Status:** proposed; implemented as a keeper hot key in M6 task 5.
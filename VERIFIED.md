# Verified facts

Build-time checklist from SPEC.md. Each row: answer, source, date checked. Nothing here is filled from memory. "Live RPC" means a `getAccountInfo` / `getProgramAccounts` read on the date shown, decoded with the IDL in `idl-ref/`.

| # | Item | Needed by | Status | Answer | Source | Checked |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | BTC quote mint(s) pump.fun approves; wrapper; decimals | M1 | **verified, PIN NEEDS HUMAN OK** | Mainnet: exactly one — `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh`, Wormhole "Wrapped BTC (Portal)", classic SPL Token, **8 decimals**. cbBTC and zBTC are NOT approved. Devnet: none. | Live RPC on QuoteControl PDA `6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP` + mint account; Jupiter token API for name | 2026-10-02 |
| V2 | Max creator fee on Custom Pairs | M1 | verified | On-chain cap `max_configurable_creator_fee_bps = 300` (3.00%), `creator_fee_configurable = true`; valid range 1..=300. Marketing/FAQ says 0.05%–1%; existing curves use values 0–300. **Spec default: 100 bps (1%)** pending human choice (see DECISIONS) | Live RPC on Global `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`; `idl-ref/pump.json`; press: fxstreet 2026-09-10, kucoin flash 2026-09-09 | 2026-10-02 |
| V3 | Instruction account lists | M1 (pump), M3/M6 (swap) | verified | See "Detail: V3". Full lists in `idl-ref/pump.json` (pump-sdk 2.0.0) and `idl-ref/pump_amm_sdk1.20.0.json` (swap-sdk 1.20.0). The docs-repo AMM IDL is stale — don't use it | `npm pack @pump-fun/pump-sdk@2.0.0` (published 2026-09-13), `@pump-fun/pump-swap-sdk@1.20.0` (2026-09-10); github.com/pump-fun/pump-public-docs @ cb188ce | 2026-10-02 |
| V4 | Creator fee recipient can be a program-owned account | M1/M2 | verified (on-chain test pending on local fork) | **Yes, and simpler than the spec assumed.** `create_v2` takes `creator: Pubkey` as a plain arg (only `user` + `mint` sign). Fees accrue in pump's `creator_vault` PDA `["creator-vault", creator]` + its quote ATA. `collect_creator_fee_v2` and PumpSwap `collect_coin_creator_fee` are **permissionless** (creator is not a signer) and pay into `ATA(creator, quote_mint)`, which must pre-exist (off-curve owner allowed). Creator must be non-executable and not owned by pump-fees program → a `satpad_vault` PDA qualifies. No CPI needed for create. Precedent: pump's own `is_holder_reward` sets creator to a PDA | pump-public-docs `docs/instructions/COIN_CREATION.md`, `COLLECT_CREATOR_FEE.md`, `PUMP_SWAP_CREATOR_FEE_README.md`; `idl-ref/pump.json` (`collect_creator_fee_v2` has no signer on `creator`); pump-sdk `src/pda.ts` `holderRewardsPda` | 2026-10-02 |
| V5 | Graduation threshold for a BTC-quoted curve, base units | M4 | open | Not documented. QuoteControl gives `initial_virtual_quote_reserves = 5082192` for wBTC; threshold must be derived from the curve math or observed from a graduated wBTC coin | — | — |
| V6 | NEAR Intents 1Click | M8 | open | | | |
| V7 | Pyth BTC/USD feed account on mainnet | M5 | open | | | |
| V8 | Helius webhook / Geyser pricing and filters | M4 | open | | | |
| V9 | Squads v4 program id and CLI | M10 | open | | | |
| V10 | Jupiter v6 route SOL→wBTC with depth | M5 | open | | | |
| V11 | Trademark "Satpad" and domain availability | before public | open | | | |
| V12 | pump.fun v2 / Custom Pairs on devnet | M1 DoD | verified — **not available** | Devnet pump program is deployed with v2 layout, but QuoteControl is uninitialized (admin = zero, 0 mints), `creator_fee_configurable = false`, whitelist = [devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`]. 0 of 95,218 devnet curves are BTC-quoted. Only pump's admin can add a quote mint. → M1 uses a local mainnet fork (DECISIONS D1) | Live RPC on devnet Global + QuoteControl + `getProgramAccounts` | 2026-10-02 |
| V14 | (added) SBPF version mainnet accepts for program deploy (v2 vs v3) and what Anchor 1.2 / Agave 4.3 emit | M10 (also M2 task 9 on the fork) | open | Anchor 1.2 emits v3 (`e_flags=3`); LiteSVM 1.5 mis-executes it (D11). Need: Agave 4.3 feature gates on mainnet for `enable_sbpf_v2/v3` | — | — |
| V13 | (added) Accounts `create_v2` / `buy_v2` read, for local-fork cloning | M1 | verified | Proven by running both on a mainnet fork. Required: pump program, Global, QuoteControl, wBTC mint (create); + pump_fees program, `fee_config` `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt`, `global_volume_accumulator` `Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y` (buy). Mayhem program CPI'd by create even when off. No Metaplex (Token-2022 metadata). Full list with roles in `scripts/local-fork.sh`. Smoke run 2026-10-02: create `2zdTGA1Go9RMhgk4MjgVfMFEavY3JcNH5uSZVDuG63AZreASruzzwPGqw2myVhSrdd2aKiK9DyHg9VGWtXmxevbn`, buy `4w6LVuenudFFb4omkkj5jaktWS7AgeWKtCdtG5NRuuEXJPNAMHef56Uf2L1oBGUsCs17EpqQJDGkdww4pT2hudpM`, curve `quote_mint=3NZ9JM…`, non-signing `creator`, `creator_fee_bps=100`, 7 sats → 1000 tokens | `scripts/local-fork.sh`, `scripts/fork-smoke.ts`, `scripts/fork-accounts.ts`; ablation by removing clones one at a time | 2026-10-02 |

## Detail

### Program ids (mainnet; same ids on devnet)
| Program | Id | Source |
| --- | --- | --- |
| Pump bonding curve | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | pump-sdk 2.0.0 `src/sdk.ts` `PUMP_PROGRAM_ID` |
| Pump fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | pump-sdk `idl/pump_fees.json` |
| PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | swap-sdk 1.20.0 |
| Mayhem | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | pump-sdk |

### V1: quote mint admission
Two mechanisms, both admin-only:
- `Global.whitelisted_quote_mints: [Pubkey; 1]` — mainnet holds USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- `QuoteControl` PDA seed `["quote-control"]` = `6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP`. Layout: 8-byte disc, `admin` (`HJD3cco5sWLatZ67RgqUk9r1CXsoNgKxgASr69mTUMLz`), 64 reserved, `mints: Vec<{mint, initial_virtual_quote_reserves: u64}>`, 190 entries on 2026-10-02. Added via `add_quote_control_mint` signed by the QuoteControl admin.

wBTC mint facts (live): program = SPL Token (not 2022), decimals 8, supply 245,065,835,304 base (≈2450.66 BTC), mint authority `BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7`, no freeze authority. Wrapper identified as Wormhole/Portal via Jupiter token metadata (`lite-api.jup.ag/tokens/v2/search`); mint authority not independently matched to the Wormhole bridge — low-risk but note it.

**Issuer risk (human note, 2026-10-02):** this is Wormhole Portal wBTC bridged from Ethereum WBTC. The spec's hard dependency "the BTC wrapper's issuer stays solvent and redeemable" therefore means **BitGo (WBTC custodian) plus the Wormhole bridge**, not Coinbase. **Pinned as `BTC_QUOTE_MINT` by human approval (DECISIONS D2).**

Existing usage: 3,406 mainnet bonding curves have `quote_mint = 3NZ9JM…` (getProgramAccounts, BondingCurve disc `[23,183,248,55,96,216,172,96]`, `quote_mint` at byte offset 83). Example: curve `BMzScNR7aRbpsZGfCegqUAvaCEzLjAFu7biBr1wWiMzL`, mint `6wF2bzWJVDah6MraZpCyU2oF7QkL91e3TyjipjExpump`, create tx `m2dFuatnvAck4kajtXsoPvb3gQssEwUvbiDcrSzNXFoWYNPfbtaKgrJXAsiPP61QSWMPJhk1Q9LwcutZpvCpiV3` (2026-09-26).

### V2: fees
Global (mainnet, live): `fee_basis_points = 95`, `creator_fee_basis_points = 5`, `creator_fee_configurable = true`, `max_configurable_creator_fee_bps = 300`, `create_v2_enabled = true`. Per curve: `BondingCurve.creator_fee_bps`, `can_edit_creator_fee`. `creator_fee_bps` passed to `create_v2` is honored only for QuoteControl mints (ignored for SOL / Global-whitelisted); 0 or omitted → pump-fees schedule (`exotic_flat_fees` for non-SOL/non-USDC quotes). Protocol fee on custom pairs matches standard schedule (0.95% curve) per pump.fun announcement as summarized by KuCoin. Post-graduation BTC tiers not documented. The pump-public-docs README says creator fee changes on a custom pair go through pump's CTO team.

### V3: account lists (summary; authoritative JSON in `idl-ref/`)
- **`create_v2`** args `name, symbol, uri, creator: Pubkey, is_mayhem_mode, is_cashback_enabled (must be false), creator_fee_bps: Option<u64>, is_holder_reward`. Accounts: `mint`[WS], `mint_authority`(["mint-authority"]), `bonding_curve`[W](["bonding-curve", mint]), `associated_bonding_curve`[W], `global`, `user`[WS], `system_program`, `token_program`(Token-2022; coin mints are Token-2022), `associated_token_program`, `mayhem_program_id`[W], `global_params`, `sol_vault`[W], `mayhem_state`[W], `mayhem_token_vault`[W], `event_authority`, `program`. **Quote mint is in remaining accounts**: `[quote_mint, associated_quote_bonding_curve, quote_token_program, (optional) quote-control PDA]`. SDK: `createV2Instruction`, `createV2AndBuyV2Instructions`, `createV2QuoteRemainingAccounts`. Arg encoding (checked against built bytes 2026-10-02): `OptionBool` and `OptionU64` are bare tuple structs — one `bool` byte / one `u64`, no tag; `creator_fee_bps = 0` means "use schedule". SDK 2.0.0 appends the `quote-control` PDA as a 4th remaining account.
- **`buy_v2`** args `amount` (tokens out), `max_sol_cost` (max quote in). 27 accounts incl. `quote_mint`, `fee_recipient` + `associated_quote_fee_recipient`, `buyback_fee_recipient` + `associated_quote_buyback_fee_recipient`, `associated_quote_bonding_curve`, `associated_quote_user`, `creator_vault`(["creator-vault", bonding_curve.creator]) + `associated_creator_vault`, `sharing_config`, `global_volume_accumulator`, `user_volume_accumulator`, `fee_config`, `fee_program`. Also `buy_exact_quote_in_v2(spendable_quote_in, min_tokens_out)`. SDK: `buyV2Instructions`, `getBuyV2InstructionRaw`.
- **`sell_v2`** args `amount, min_sol_output`; same accounts as buy_v2 minus `global_volume_accumulator`. SDK: `sellV2Instructions`.
- **`collect_creator_fee_v2`** no args; `creator`[W, NOT signer], `creator_token_account`[W], `creator_vault`[W], `creator_vault_token_account`[W], `quote_mint`, `quote_token_program`, `associated_token_program`, `system_program`, `event_authority`, `program`. SDK (online): `collectCoinCreatorFeeV2Instructions(coinCreator, quoteMint, quoteTokenProgram)`.
- **PumpSwap `deposit`** args `lp_token_amount_out, max_base_amount_in, max_quote_amount_in`; `pool`[W], `global_config`, `user`[S], `base_mint`, `quote_mint`, `lp_mint`[W], user base/quote/pool token accounts[W], pool base/quote token accounts[W], `token_program`, `token_2022_program`, `event_authority`, `program`.
- **PumpSwap `buy`/`sell`**: explicit `quote_mint` + `quote_token_program` on every instruction (not WSOL-only); include `coin_creator_vault_ata`[W] + `coin_creator_vault_authority`(["creator_vault", pool.coin_creator]), `fee_config`, `fee_program`.
- **PumpSwap `collect_coin_creator_fee`** no args, no signer: `quote_mint`, `quote_token_program`, `coin_creator`, `coin_creator_vault_authority`, `coin_creator_vault_ata`[W], `coin_creator_token_account`[W], `event_authority`, `program`.

### V4: creator-fee routing — design consequences
1. `declare_coin` checks `bonding_curve.creator == CoinFee PDA`, `bonding_curve.quote_mint == BTC_QUOTE_MINT`, and `creator_fee_bps` in the allowed range.
2. `create_v2` is signed by the user wallet; `creator` = `CoinFee` PDA as a plain arg. No CPI from `satpad_vault` for creation.
3. `CoinFee`'s wBTC ATA must be created before the first collect (`declare_coin` does it).
4. Keeper cranks the permissionless collects; `satpad_vault::settle` then CPI-signs as `CoinFee` to split.
5. Never use `is_holder_reward` (locks creator to pump's PDA) or pump's fee-sharing config (breaks `collect_creator_fee*` for the PDA). `set_creator` exists but is gated to pump's admin.
6. Unverified: PumpSwap's backend "sets `coin_creator` if missing" behaviour for PDA creators — test at graduation on the fork.

### SDK stack
Both SDKs depend on `@solana/web3.js ^1.98.2` and `@coral-xyz/anchor ^0.31.1`; no `@solana/kit`. Spec's "`@solana/kit` for RPC" is therefore a mixed stack — see DECISIONS.

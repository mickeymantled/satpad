# Status

**Current milestone:** 1 — Repo and SDK
**Last completed step:** Research for V1–V5, V12 done by three Sonnet agents (2026-10-02); findings not yet written into VERIFIED.md. Extracted IDLs saved in `idl-ref/`.
**Next step:** Write V1–V5, V12 into VERIFIED.md from the agent findings (summary below), then DECISIONS.md entry for the local-fork decision, then `scripts/local-fork.sh`. Solana CLI is NOT installed on this machine; ask human before installing (`release.anza.xyz` installer).
**Blockers:** Solana CLI install needed before item 2 (empirical create_v2 on fork) can be checked.

## Human decision received 2026-10-02 (paste, pre-restart)
Milestone 1 targets a local `solana-test-validator` fork of mainnet, not devnet. Clone mainnet pump.fun + PumpSwap programs, mainnet QuoteControl, the BTC quote mint, and any per-mint config PDA `create_v2` reads. New M1 DoD: coin created on the local fork with `quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`. Before writing DECISIONS.md: (1) confirm QuoteControl lists 3NZ9JM + wrapper + decimals in VERIFIED.md, (2) confirm which accounts `create_v2` reads and clone them all, (3) confirm `creator_fee_configurable` and max creator fee on mainnet. Then DECISIONS entry, `scripts/local-fork.sh`, update STATUS, show result.

## Research findings to record (all live-sourced 2026-10-02)
- Pump program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; pump fees `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`; PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; Mayhem `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`.
- SDKs: `@pump-fun/pump-sdk@2.0.0` (2026-09-13), `@pump-fun/pump-swap-sdk@1.20.0` (2026-09-10); both web3.js v1 + anchor 0.31, no @solana/kit.
- Global PDA `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`: whitelist=[USDC], `creator_fee_configurable=true`, `max_configurable_creator_fee_bps=300`, fee_bps=95, creator_fee_bps=5.
- QuoteControl PDA `6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP` (seed "quote-control"): admin `HJD3cco5sWLatZ67RgqUk9r1CXsoNgKxgASr69mTUMLz`, 190 mints. Only BTC mint: `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh` = Wormhole "Wrapped BTC (Portal)", SPL Token, 8 decimals, initial_virtual_quote_reserves=5082192. cbBTC/zBTC NOT approved. 3406 mainnet curves use it; example curve `BMzScNR7aRbpsZGfCegqUAvaCEzLjAFu7biBr1wWiMzL`, mint `6wF2bzWJVDah6MraZpCyU2oF7QkL91e3TyjipjExpump`, tx `m2dFuatnvAck4kajtXsoPvb3gQssEwUvbiDcrSzNXFoWYNPfbtaKgrJXAsiPP61QSWMPJhk1Q9LwcutZpvCpiV3`.
- Devnet: QuoteControl exists but empty, `creator_fee_configurable=false`, whitelist=[devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`]. No BTC quote possible on devnet.
- `create_v2` args: name, symbol, uri, `creator: Pubkey` (plain arg, not signer), is_mayhem_mode, is_cashback_enabled(must be false), `creator_fee_bps: Option<u64>` (1..=300, only honored for quote-control mints), is_holder_reward. Signers: `user`, `mint`. Quote mint passed as remaining accounts [quote_mint, associated_quote_bonding_curve, quote_token_program, (optional quote-control PDA)]. Named accounts include mayhem program + global_params + sol_vault + mayhem_state + mayhem_token_vault, event_authority.
- Creator fee → `creator_vault` PDA ["creator-vault", creator] + its quote ATA; `collect_creator_fee_v2` is PERMISSIONLESS (creator not a signer), pays into ATA(creator, quote_mint) which must pre-exist (off-curve owner ok). Creator must be non-executable and not owned by pump fees program → a satpad_vault PDA works as creator. No CPI needed for create. Precedent: pump's own `is_holder_reward` sets creator to a PDA. Same for PumpSwap `collect_coin_creator_fee` (permissionless, coin_creator copied from curve). Do NOT use `is_holder_reward` or fee-sharing config.
- Press: creator fee marketed 0.05%–1% (FAQ) vs on-chain cap 300 bps; on-chain curves show values 0..300. Protocol fee 0.95% curve; custom pairs same schedule (KuCoin). Exotic quotes use pump_fees `exotic_flat_fees`.
- Graduation threshold for BTC curves: not documented (V5 still open).
- Account lists for buy_v2/sell_v2/collect/deposit: see `idl-ref/pump.json`, `idl-ref/pump_amm_sdk1.20.0.json` (docs-repo AMM IDL is stale). Scratch research scripts were in the session scratchpad (may be gone after restart).


## Milestone 1 definition of done
A coin exists on devnet with `quote_mint = BTC_QUOTE_MINT`, created and bought by a script.

## Plan (milestone 1, awaiting confirmation)
1. Monorepo scaffold: pnpm workspaces, Node 22, TS strict, vitest, eslint, root scripts, `.env.example`, directory skeleton per SPEC layout
2. `packages/sdk`: `quoteMints.ts` with pinned `BTC_QUOTE_MINT` + decimals (blocked on V1 + human approval)
3. `packages/sdk`: `satpad_vault` program id placeholder + PDA derivations (`config`, `coin_fee`, `coin`, `payee_pot`, `rewards_pot`, `lp_pot`, `rewards_run`) with tests
4. `packages/sdk`: Config / Coin account TypeScript types and bigint amount helpers (BTC base units ↔ sats ↔ ui string) with tests
5. `packages/sdk`: pump.fun v2 wrappers — `buildCreateV2`, `buildBuyV2`, `buildSellV2`, `buildCollectCreatorFee` for the pinned mint, using `@pump-fun/pump-sdk` (blocked on V3, V4) with tests against the IDL account lists
6. `scripts/devnet-create-and-buy.ts` with `--dry-run`: creates a BTC-quoted coin on devnet and buys it (blocked on V12)
7. Run the script on devnet, record signatures and mint in `packages/sdk/MILESTONE.md` as DoD evidence

## Done
(none yet)

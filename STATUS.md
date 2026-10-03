# Status

**Current milestone:** 1 — Repo and SDK
**Last completed step:** Kickoff: CLAUDE.md, STATUS.md, VERIFIED.md, DECISIONS.md created
**Next step:** Verify V1–V4 and V12 (milestone 1 dependencies); show VERIFIED.md to human before any code
**Blockers:** V1 (pinning the BTC quote mint) needs human sign-off per CLAUDE.md

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

# @satpad/sdk — milestone 1: Repo and SDK

**Status: closed 2026-10-02.** Definition of done (DECISIONS D1): a coin created on the local mainnet fork with
`quote_mint = BTC_QUOTE_MINT`, bought once with `buy_v2`, by a script in the repo — **met**.

## Built
- Package scaffold (CJS, strict TS, vitest; pump SDKs inlined in vitest for CJS/ESM interop). `main`/`types` point at
  `src/` so workspace consumers run through tsx without a build step; `pnpm build` emits `dist/` for later.
- `src/quoteMints.ts`: `BTC_QUOTE_MINT` (Wormhole wBTC, D2), `BTC_QUOTE_DECIMALS=8`, `DEFAULT_CREATOR_FEE_BPS=100` /
  `MAX_CREATOR_FEE_BPS=100` (D3), pump program ids, Global + QuoteControl PDAs.
- `src/pda.ts`: `configPda`, `coinFeePda`, `coinPda`, `payeePotPda`, `rewardsPotPda`, `lpPotPda`,
  `rewardsRunPda(mint, u64)`, `coinFeeAta`. `rewards_run` index encoded u64 LE (spec unspecified; program must match).
- `src/amounts.ts`: bigint-only money — `Sats` brand, `parseBtc`/`parseSats`/`toUi`/`splitBtc`, `applyBps`,
  `splitFee` (liquidity share absorbs the floor remainder so parts sum exactly and the 2500 bps floor holds — D7; program mirrors this), `assertValidSplit`
  (liquidity ≥ 2500, operator ≤ 2000, sum 10000).
- `src/types.ts`: `Config`, `Coin`, `RewardsRun`, `PayeeMode`, `Stage`. `Config.creatorFeeBps` added per D3.
- `src/pump.ts`: pump.fun v2 builders pinned to wBTC — `buildCreateV2` (mayhem/holder-reward/cashback off, fee bps
  1..=100), `buildBuyV2` (+ idempotent Token-2022 ATA), `buildSellV2`, `buildCollectCreatorFeeV2` (permissionless),
  `coinAccounts`, `quoteTokensForSats`/`quoteSatsForTokens`/`quoteSatsForSell`, `PUMP_BUYBACK_FEE_RECIPIENTS`
  (pinned; SDK picks at random and does not export the list), `defaultFeeRecipients`.
- 26 vitest tests; account lists, flags and arg bytes asserted against `idl-ref/pump.json`.

## How to run
```bash
pnpm install
pnpm --filter @satpad/sdk test        # 26 tests
pnpm typecheck && pnpm lint
scripts/local-fork.sh --detach        # mainnet fork, ~3s
pnpm fork:m1 -- --dry-run             # simulate only
pnpm fork:m1                          # definition of done
kill $(cat .fork-ledger/validator.pid)
```

## Definition-of-done evidence (local fork, 2026-10-02, task 6 commit 68d49b6)
| | |
| --- | --- |
| mint | `AdDiymcCDpXvcQnmsY9D9USL2h7fmm1wzQJMMb4bn96M` |
| CoinFee PDA (= pump `creator`, never signed) | `EeQEP3RGuXkgdY3T9towdCzTfdHx2L5GEgoNreR5DN9d` |
| create_v2 | `26YoJv48dpEcnkgMpD8rYNoWMgbBDybAvBT2dX1C3Hvo1aRoV3CVj3xtNbLjpCdaVuXHi9HPMGJHWmMynBnmsB5F` (125,221 CU) |
| buy_v2 | `4g2gTHTfS4hzqmWVNQdNyEQ22sdiLPe8fwjHtX1jB2ryG9u2tb4Ge6mvZoarFWqG7nrBs5tLMayn5pVgAYQqtWBR` (156,188 CU) |
| curve.quote_mint | `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh` ✓ |
| curve.creator_fee_bps | 100 ✓ |
| 1000 tokens cost | 7 sats, quoted 7 sats by `quoteSatsForTokens` ✓ |
| creator fee accrued in CoinFee's creator_vault wBTC ATA | 1 sat ✓ — proves fee routing to a program PDA with no CPI (D4) |

Fork signatures are not on any public explorer; re-run `pnpm fork:m1` to reproduce (new mint each run).

## Deferred
- `buy_exact_quote_in_v2` wrapper (spend-exact-sats buys) — M5 when the buy panel needs it.
- PumpSwap wrappers (`deposit`, `buy`/`sell`, `collect_coin_creator_fee`) — M3/M6.
- `satpad_vault` instruction builders and account decoders — M2, generated from the Anchor IDL.
- Dev program id `52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93` is a placeholder; mainnet uses a fresh key.
- Graduation threshold for a wBTC curve (VERIFIED V5) still open; needed by M4.

## Addendum 2026-10-05 (M6)
- `src/amm.ts`: PumpSwap wrappers over `@pump-fun/pump-swap-sdk@1.20.0` (pool PDA, Token-2022 LP mint, swap/liquidity state, bigint quote math, buy/sell/deposit/collect builders) with unit tests on a captured pool state (`test/fixtures/amm_state.json`, `scripts/capture-amm-state.ts`). `buildSetSatpad` for D21.

# @satpad/sdk — milestone 1

## Built
- Package scaffold (CJS, strict TS, vitest; pump SDKs inlined in vitest for CJS/ESM interop).
- `src/quoteMints.ts`: `BTC_QUOTE_MINT` (Wormhole wBTC, D2), `BTC_QUOTE_DECIMALS=8`, `DEFAULT_CREATOR_FEE_BPS=100` / `MAX_CREATOR_FEE_BPS=100` (D3), pump program ids, Global + QuoteControl PDAs.
- `src/pda.ts`: `configPda`, `coinFeePda`, `coinPda`, `payeePotPda`, `rewardsPotPda`, `lpPotPda`, `rewardsRunPda(mint, u64)`, `coinFeeAta`. `rewards_run` index encoded u64 LE (spec left it unspecified; program must match).
- `src/amounts.ts`: bigint-only money — `Sats` brand, `parseBtc`/`parseSats`/`toUi`/`splitBtc`, `applyBps`, `splitFee` (deployer share absorbs floor remainder so parts sum exactly; program mirrors this), `assertValidSplit` (liquidity ≥ 2500, operator ≤ 2000, sum 10000).
- `src/types.ts`: `Config`, `Coin`, `RewardsRun`, `PayeeMode`, `Stage` as the M2 IDL will shape them. `Config.creatorFeeBps` added per D3.

## How to run
- `pnpm --filter @satpad/sdk test`
- `pnpm --filter @satpad/sdk typecheck`

## Deferred
- STATUS.md tasks 5–7.

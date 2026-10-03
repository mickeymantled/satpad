# @satpad/sdk — milestone 1

## Built
- Package scaffold (CJS, strict TS, vitest; pump SDKs inlined in vitest for CJS/ESM interop).
- `src/quoteMints.ts`: `BTC_QUOTE_MINT` (Wormhole wBTC, D2), `BTC_QUOTE_DECIMALS=8`, `DEFAULT_CREATOR_FEE_BPS=100` / `MAX_CREATOR_FEE_BPS=100` (D3), pump program ids, Global + QuoteControl PDAs.

## How to run
- `pnpm --filter @satpad/sdk test`
- `pnpm --filter @satpad/sdk typecheck`

## Deferred
- STATUS.md tasks 3–7.

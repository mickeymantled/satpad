# web — milestone 5 (in progress)

## Built
- Task 1: Next.js 15.5 (App Router, React 19, TS strict, Tailwind 4) scaffold as `@satpad/web`. Dark theme tokens in
  `app/globals.css`; `app/layout.tsx` with header nav and the SPEC disclosure footer on every page; stub routes `/`,
  `/coin/[mint]`, `/launch`, `/btc`, `/ledger`, `/docs`; `lib/env.ts` (NEXT_PUBLIC_* only). Wallets via Wallet Standard
  discovery (Phantom/Solflare/Backpack) + `@solana/wallet-adapter-unsafe-burner` for dev/e2e — the heavy
  `wallet-adapter-wallets` bundle is not used. `scripts/check-no-dev-swap.sh` (D17): `pnpm build` fails if the dev-swap
  marker appears in `.next` output. Playwright config (Chromium, starts `next dev` with `NEXT_PUBLIC_DEV_SWAP=1`,
  reuses a running server); `e2e/smoke.spec.ts` passes. Root `pnpm lint` also lints the web app.

- Task 2: `lib/api.ts` typed client mirroring the API responses (amounts stay base-unit strings), `lib/format.ts`
  (BTC / sats / USD / tokens / compact / pct / short / ago — bigint until the final string), `lib/links.ts` (explorer
  links aware of the custom cluster), `lib/live.ts` (`useLive()` over `WS /live` with backoff; `parseLiveEvent`
  validates shapes). Unit tests (3 suites) via vitest with the pump SDK inline fix; tsconfig target ES2022 for BigInt.

## Deferred
- Tasks 2–8 (STATUS.md).

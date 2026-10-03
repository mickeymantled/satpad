# @satpad/web

Next.js 15 app (SPEC "Frontend"). Dark theme; every number in BTC, sats and USD.

```bash
pnpm --filter @satpad/web dev        # http://127.0.0.1:3000 (needs API on :8083; see .env.example NEXT_PUBLIC_*)
pnpm --filter @satpad/web build      # production build + D17 check (no dev-swap code in the bundle)
pnpm --filter @satpad/web e2e        # Playwright against the local fork
```

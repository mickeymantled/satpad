#!/usr/bin/env bash
# DECISIONS D17: the fork-only faucet swap must not exist in production bundles. `next build` with
# NEXT_PUBLIC_DEV_SWAP unset must leave no trace of the module; this fails the build if any chunk mentions it.
set -euo pipefail
cd "$(dirname "$0")/.."
MARKER="satpad-dev-swap-faucet"   # unique string exported by lib/devSwap.ts and nowhere else
if [[ "${NEXT_PUBLIC_DEV_SWAP:-}" == "1" ]]; then echo "dev-swap build (NEXT_PUBLIC_DEV_SWAP=1): skipping production check"; exit 0; fi
if grep -rIl --include='*.js' "$MARKER" .next/static .next/server 2>/dev/null | head -1 | grep -q .; then
  echo "FAIL: dev swap module present in production bundle:"; grep -rIl --include='*.js' "$MARKER" .next/static .next/server; exit 1
fi
echo "ok: no dev-swap code in production bundle"

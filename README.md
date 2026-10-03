# Satpad

Memecoin launchpad on Solana. Every coin is a pump.fun coin quoted in BTC (Wormhole wBTC). See [SPEC.md](SPEC.md) (source of truth), [STATUS.md](STATUS.md) (where we are), [VERIFIED.md](VERIFIED.md) (live-sourced facts), [DECISIONS.md](DECISIONS.md) (deviations and approvals).

## Layout
```
programs/satpad_vault/   Anchor program (milestone 2)
packages/sdk/            @satpad/sdk — PDAs, builders, pump.fun v2 wrappers, vault client
packages/db/             @satpad/db — Drizzle schema + migrations (Postgres 16): coins, ledger, keeper_health
keeper/  indexer/  api/  web/   services (milestones 3–5)
scripts/                 local fork, admin ops (every admin action is a script with --dry-run)
tests/                   anchor bankrun + integration (milestone 2+)
idl-ref/                 pump.fun / PumpSwap IDLs pinned from the SDKs on 2026-10-02
```

## Prereqs
Node 22, pnpm 11, Solana CLI 4.1.2 (`$HOME/.local/share/solana/install/active_release/bin`), Rust 1.89 + Anchor CLI 1.2 (`rustup`, `avm`).

## Quick start
```bash
pnpm install
pnpm fork -- --detach      # local mainnet fork with pump.fun + wBTC quote
pnpm fork:smoke            # create_v2 + buy_v2 quoted in wBTC
pnpm test && pnpm typecheck && pnpm lint
pnpm test:vault            # anchor build + LiteSVM program tests
docker run -d --name satpad-postgres -e POSTGRES_USER=satpad -e POSTGRES_PASSWORD=satpad -e POSTGRES_DB=satpad -p 55433:5432 postgres:16-alpine
pnpm db:migrate            # keeper/indexer schema
```

# Satpad

Memecoin launchpad on Solana. Every coin is a pump.fun coin quoted in BTC (Wormhole wBTC). See [SPEC.md](SPEC.md) (source of truth), [STATUS.md](STATUS.md) (where we are), [VERIFIED.md](VERIFIED.md) (live-sourced facts), [DECISIONS.md](DECISIONS.md) (deviations and approvals).

## Layout
```
programs/satpad_vault/   Anchor program (milestone 2)
packages/sdk/            @satpad/sdk — PDAs, builders, pump.fun v2 wrappers
keeper/  indexer/  api/  web/   services (milestones 3–5)
scripts/                 local fork, admin ops (every admin action is a script with --dry-run)
tests/                   anchor bankrun + integration (milestone 2+)
idl-ref/                 pump.fun / PumpSwap IDLs pinned from the SDKs on 2026-10-02
```

## Prereqs
Node 22, pnpm 11, Solana CLI 4.3 (`$HOME/.local/share/solana/install/active_release/bin`), Rust 1.89 + Anchor CLI 1.2 (`rustup`, `avm`).

## Quick start
```bash
pnpm install
pnpm fork -- --detach      # local mainnet fork with pump.fun + wBTC quote
pnpm fork:smoke            # create_v2 + buy_v2 quoted in wBTC
pnpm test && pnpm typecheck && pnpm lint
pnpm test:vault            # anchor build + LiteSVM program tests
```

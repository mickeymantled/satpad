Transactions recorded from the local mainnet fork with `pnpm fixtures:capture` (2026-10-03, soak fork). Each file is
`{ signature, ...getTransaction(sig, { maxSupportedTransactionVersion: 0 }) }`. `launch_v0.json` (create_v2 + declare_coin +
buy_v2 in one v0 transaction) must be captured on a fresh fork right after `pnpm fork:seed`, because the test validator
retains only ~60 slots of history; it is missing until then.

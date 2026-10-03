SBPF v3 build of an Anchor 1.2 program corrupts account keys during account validation; identical source on SBPF v2 is fine

Reproduction: https://github.com/mickeymantled/satpad (commit fe7b16a). Cross-ref: #114 "Corrupted reference constants".

## Reproduce
```bash
git clone https://github.com/mickeymantled/satpad && cd satpad && pnpm install
SBPF_ARCH=v3 scripts/build-vault.sh && pnpm --filter @satpad/tests test      # 14 failures, all in instruction `settle`
scripts/build-vault.sh && pnpm --filter @satpad/tests test                   # SBPF v2: 66/66 pass
```
`scripts/build-vault.sh` = `anchor build` (IDL) then `cargo build-sbf --tools-version v1.57 --arch $SBPF_ARCH`; the ELF `e_flags` is 3 vs 2. The same result holds on `solana-test-validator` 4.1.2 (`scripts/local-fork.sh --detach && pnpm fork:m2`, needs mainnet clones) and on LiteSVM 1.5.0 (the test suite).

## Toolchain
- Anchor CLI 1.2.0 (its default is `--arch v3`, platform-tools v1.57), cargo-build-sbf 4.1.0, rustc 1.89.0, macOS arm64 host
- Reproduces with platform-tools **v1.54 and v1.57** → arch-specific, not a tools-version regression
- `[profile.release] overflow-checks = true, lto = "fat", codegen-units = 1` (Anchor template defaults)

## Symptom
An Anchor program's instruction `settle` has 12 accounts: `Account<Config>` (~330 bytes), an `UncheckedAccount` used as a seed, `Account<Coin>` with `seeds = [b"coin", mint.key().as_ref()], bump = coin.bump, has_one = mint`, a PDA `UncheckedAccount`, six `InterfaceAccount<TokenAccount>` (three with `associated_token::mint/authority/token_program` constraints, two of those authorities being field paths `config.<pubkey field>`), an `InterfaceAccount<Mint>`, `Interface<TokenInterface>`.
- tools v1.57, `--arch v3`: `AnchorError caused by account: coin. Error Code: ConstraintSeeds` — the PDA derived on-chain from `mint.key()` is wrong. In a `has_one`-only variant the two logged keys share their first 8 bytes and diverge after (`6whuj57y3mh9RY2m…` vs `6whuj57y3mhEjXce…`).
- tools v1.54, `--arch v3`: `ProgramFailedToComplete`.
- Variants of the struct: `Access violation reading 8 bytes at address 0x5eff594e4cff74ff (in unallocated region)`.
- `--arch v2` or `v1`, either tools version: all pass.

## Narrowing
- Account validation only: a no-op handler still fails.
- Not the Anchor seeds expansion: anchor-syn 1.2 `generate_constraint_seeds` is inline and the same expansion works on v2.
- A minimal program (`programs/sbpf_repro`, run with `pnpm repro:sbpf` against the validator) with the same `seeds + stored bump + has_one` on an `UncheckedAccount` key, plus variants (Signer, manual comparison, +10 accounts, 6 `InterfaceAccount<TokenAccount>` / 3 `associated_token` constraints) **passes** on v3. The trigger needs the full `Settle` struct.
- Bisecting `Settle` on v3: removing either field-path-authority ATA constraint makes the `coin` check pass but a *different* constraint then fails (`ConstraintAssociatedTokenTokenProgram`); replacing the field-path authorities with explicit accounts yields the access violation. The fault moves with frame layout.
- A sibling instruction (`recover`: 9 accounts, same `coin` check, two ATA constraints with account/const authorities, PDA-signed CPI) passes on v3.

I can provide both `.so` files and narrow further with guidance on what to dump.

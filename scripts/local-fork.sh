#!/usr/bin/env bash
# Satpad M1: local solana-test-validator fork of mainnet with pump.fun create_v2/buy_v2 quoted in wBTC.
#
# Usage: scripts/local-fork.sh [--dry-run] [--detach]
#   --dry-run  print the validator command, run nothing (no RPC calls, no files written)
#   --detach   start in background (log: .fork-ledger/validator.log) and wait until RPC is healthy
# Env: FORK_RPC_URL  source RPC for clones (default https://api.mainnet-beta.solana.com; publicnode 403s the test-validator clone requests)
#      SOLANA_BIN    dir holding solana-test-validator (default $HOME/.local/share/solana/install/active_release/bin)
# Idempotent: always `--reset`s the ledger in .fork-ledger/ledger (gitignored).
#
# wBTC (3NZ9JM..., Wormhole Portal, SPL Token, 8 dec) is NOT cloned verbatim: scripts/fork-prepare-mint.ts
# fetches it (read-only), patches mint_authority to the local keypair scripts/fork-keys/wbtc-authority.json
# (generated, gitignored) and the result is loaded with --account. scripts/fork-smoke.ts then mints wBTC
# with @solana/spl-token (no spl-token CLI needed). Everything else is a verbatim mainnet clone.
#
# Account list derived with the SDK by scripts/fork-accounts.ts (PDA helpers in pump-sdk src/pda.ts) and
# the create_v2 / buy_v2 account lists in idl-ref/pump.json. Native/SPL programs (system, Token, Token-2022,
# ATA) are built into the validator. create_v2 uses Token-2022 metadata extension: no Metaplex needed.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0; DETACH=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --detach) DETACH=1;; *) echo "unknown arg $a" >&2; exit 2;; esac; done

export PATH="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}:$PATH"
URL="${FORK_RPC_URL:-https://api.mainnet-beta.solana.com}"
DIR=".fork-ledger"
MINT_JSON="$DIR/wbtc-mint.json"

# satpad_vault: loaded as an upgradeable program with the dev upgrade-authority key so set_lp can be exercised.
# Build first: scripts/build-vault.sh (SBPF v2, what LiteSVM runs) or SBPF_ARCH=v3 scripts/build-vault.sh (Anchor default).
VAULT_SO="target/deploy/satpad_vault.so"
VAULT_ID="52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93"
UPGRADE_AUTHORITY="${VAULT_UPGRADE_AUTHORITY:-U3CGV1FvYBnHDf9CNmEwEMW97CXE1BWo1pK7QqvNKav}"   # keys/upgrade-authority-dev.json
[[ $DRY -eq 1 || -f "$VAULT_SO" ]] || { echo "missing $VAULT_SO — run scripts/build-vault.sh" >&2; exit 1; }

# VERIFIED V14 repro program, loaded only when built (never deployed anywhere real).
REPRO=()
[[ -f target/deploy/sbpf_repro.so ]] && REPRO=(--upgradeable-program 7JLG4yR2ohNn21SSXf7eiPCnWfqiMtMPoUaDQuTDphuW target/deploy/sbpf_repro.so "$UPGRADE_AUTHORITY")

CMD=(solana-test-validator --reset --ledger "$DIR/ledger" --url "$URL" --rpc-port 8899
  --upgradeable-program "$VAULT_ID" "$VAULT_SO" "$UPGRADE_AUTHORITY"  # satpad_vault (this repo)
  "${REPRO[@]}"
  # --- programs (program + programdata) ---
  --clone-upgradeable-program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P  # pump.fun
  --clone-upgradeable-program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA  # PumpSwap (not read by create/buy; cloned for later milestones)
  --clone-upgradeable-program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ  # pump fees program (CPI'd by buy_v2)
  --clone-upgradeable-program MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e  # Mayhem program (create_v2 CPIs it even when is_mayhem_mode=false)
  # --- accounts ---
  --account 3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh "$MINT_JSON"  # wBTC mint, mint_authority patched to local keypair
  --clone 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf  # pump Global (seed "global"): fees, whitelist, creator_fee_configurable, max bps
  --clone 6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP  # QuoteControl (seed "quote-control"): approves wBTC as quote, create_v2 remaining[3]
  --clone 13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ  # mayhem global_params (create_v2 named account; ablation: not needed when is_mayhem_mode=false, kept for mayhem coins)
  --clone BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s  # mayhem sol_vault (create_v2 named account; same as above)
  --clone Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1  # pump event_authority (emit_cpi; system-owned, ablation: not needed)
  --clone 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt  # pump_fees fee_config (buy_v2 fee tiers)
  --clone Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y  # pump global_volume_accumulator (buy_v2)
  --clone 62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV  # fee_recipient = Global.fee_recipient (buy_v2; ablation: not needed, but kept; smoke pins this one)
  --clone Dxe22pvU3G24atApYGQY6EhgD1NNiTQSqNaP77chkd9H  # fee_recipient's wBTC ATA (associated_quote_fee_recipient)
  --clone 9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7  # buyback_fee_recipient (SDK CURRENT_FEE_RECIPIENTS_FOR_BUYBACK[1]; smoke pins it)
  --clone 7yLvEgewyd3qfG7uvs4KV592uMFdwnNXTAazZ9hidW6A  # buyback recipient's wBTC ATA (associated_quote_buyback_fee_recipient)
)

if [[ $DRY -eq 1 ]]; then
  echo "# would run: npx tsx scripts/fork-prepare-mint.ts $MINT_JSON"
  printf '%q ' "${CMD[@]}" | sed 's/ --/ \\\n  --/g'; echo
  exit 0
fi

mkdir -p "$DIR"
npx tsx scripts/fork-prepare-mint.ts "$MINT_JSON"
if [[ $DETACH -eq 1 ]]; then
  nohup "${CMD[@]}" >"$DIR/validator.log" 2>&1 &
  echo $! >"$DIR/validator.pid"
  start=$(date +%s)
  until solana --url http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; do
    kill -0 "$(cat "$DIR/validator.pid")" 2>/dev/null || { tail -20 "$DIR/validator.log"; echo "validator died" >&2; exit 1; }
    sleep 1
  done
  echo "validator up in $(( $(date +%s) - start ))s (pid $(cat "$DIR/validator.pid"))"
else
  exec "${CMD[@]}"
fi

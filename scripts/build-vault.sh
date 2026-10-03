#!/usr/bin/env bash
# Builds satpad_vault: `anchor build` for the IDL and type generation, then rebuilds the .so for SBPF v2 because
# LiteSVM 1.5 mis-executes the SBPF v3 binary Anchor 1.2 emits by default (DECISIONS D11; VERIFIED V14 tracks what
# mainnet accepts). Override with SBPF_ARCH=v3 to get Anchor's default.
set -euo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}:$PATH"
ARCH="${SBPF_ARCH:-v2}"
anchor build "$@"
if [[ "$ARCH" != "v3" ]]; then
  cargo build-sbf --arch "$ARCH" --manifest-path programs/satpad_vault/Cargo.toml
fi
# The SDK ships the IDL so consumers never need target/ (gitignored).
cp target/idl/satpad_vault.json packages/sdk/src/vault/idl.json
python3 - <<'PY'
import struct
d = open("target/deploy/satpad_vault.so", "rb").read()
print(f"satpad_vault.so: {len(d)} bytes, SBPF v{struct.unpack('<I', d[48:52])[0]}")
PY

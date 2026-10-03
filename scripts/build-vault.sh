#!/usr/bin/env bash
# Builds satpad_vault: `anchor build` (IDL, SDK types; it emits an SBPF v3 .so with platform-tools v1.57 by default),
# then rebuilds the .so for SBPF v2 with the same platform-tools, because the v3 build of this program is broken on
# LiteSVM AND on the real validator (DECISIONS D11/D15, VERIFIED V14). SBPF_ARCH=v3 reproduces the failure.
set -euo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}:$PATH"
ARCH="${SBPF_ARCH:-v2}"
TOOLS="${PLATFORM_TOOLS:-v1.57}"   # Anchor 1.2 default; pinned (DECISIONS D15). cargo-build-sbf 4.1.0 alone would pick v1.54.
anchor build "$@"
if [[ "$ARCH" != "v3" ]]; then
  cargo build-sbf --tools-version "$TOOLS" --arch "$ARCH" --manifest-path programs/satpad_vault/Cargo.toml
fi
# The SDK ships the IDL so consumers never need target/ (gitignored).
cp target/idl/satpad_vault.json packages/sdk/src/vault/idl.json
python3 - <<'PY'
import struct
d = open("target/deploy/satpad_vault.so", "rb").read()
print(f"satpad_vault.so: {len(d)} bytes, SBPF v{struct.unpack('<I', d[48:52])[0]}")
PY

#!/usr/bin/env bash
# M3 definition-of-done soak: fresh fork, 10 seeded coins, continuous random trading, the keeper running unattended
# for DURATION_S (default 24 h), then the reconciler. Writes a summary into STATUS.md and keeper/MILESTONE.md
# (human addition to the M3 plan). Detached: nohup scripts/fork-soak.sh > .fork-ledger/soak.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}:$PATH"
export DATABASE_URL="${DATABASE_URL:-postgres://satpad:satpad@127.0.0.1:55433/satpad}"
export SOLANA_RPC_URL=http://127.0.0.1:8899 PRIORITY_FEE_MODE=fixed SETTLE_INTERVAL_MS="${SETTLE_INTERVAL_MS:-60000}" LOG_LEVEL=info HEALTH_PORT=8081
DURATION_S="${DURATION_S:-86400}"; COINS="${COINS:-10}"; RATE_MS="${RATE_MS:-3000}"
mkdir -p .fork-ledger
START=$(date -u +%FT%TZ); START_TS=$(date +%s)
echo "soak start $START duration ${DURATION_S}s coins $COINS trade every ${RATE_MS}ms"

scripts/local-fork.sh --detach || exit 1
pnpm -s db:migrate && docker exec satpad-postgres psql -U satpad -d satpad -q -c "TRUNCATE ledger, coins, keeper_health"
pnpm -s fork:seed --coins "$COINS" | grep -v bigint || exit 1
START_SLOT=$(solana -u http://127.0.0.1:8899 slot)
export KEEPER_KEYPAIR="$PWD/scripts/fork-keys/keeper.json"

pnpm -s fork:trade --rate-ms "$RATE_MS" --duration-s "$DURATION_S" > .fork-ledger/soak-trader.log 2>&1 &
TRADER=$!
(cd keeper && npx tsx src/main.ts) > .fork-ledger/soak-keeper.log 2>&1 &
KEEPER=$!
echo "trader pid $TRADER keeper pid $KEEPER start slot $START_SLOT"

# Wait for the trader to finish (DURATION_S), then let the keeper catch the tail, then stop it.
wait "$TRADER"
sleep $(( SETTLE_INTERVAL_MS / 1000 * 2 + 10 ))
kill "$KEEPER" 2>/dev/null; wait "$KEEPER" 2>/dev/null
HEALTH=$(curl -s "http://127.0.0.1:$HEALTH_PORT/healthz" 2>/dev/null || echo "{}")

pnpm -s fork:check --since-slot "$START_SLOT" --json .fork-ledger/soak-reconcile.json > .fork-ledger/soak-check.log 2>&1
CHECK=$?
TICKS_OK=$(grep -c '"msg":"tick ok"' .fork-ledger/soak-keeper.log || true)
TICKS_FAIL=$(grep -c '"msg":"tick failed"' .fork-ledger/soak-keeper.log || true)
COIN_FAILS=$(grep -c '"msg":"coin failed"' .fork-ledger/soak-keeper.log || true)
TRADES=$(grep -o '"trades":[0-9]*' .fork-ledger/soak-trader.log | tail -1 | cut -d: -f2)
TRADE_ERRS=$(grep -o '"errors":[0-9]*' .fork-ledger/soak-trader.log | tail -1 | cut -d: -f2)
SETTLES=$(python3 -c "import json;print(json.load(open('.fork-ledger/soak-reconcile.json'))['settles'])" 2>/dev/null || echo "?")
PAYOUTS=$(python3 -c "import json;print(json.load(open('.fork-ledger/soak-reconcile.json'))['payouts'])" 2>/dev/null || echo "?")
MAXLAG=$(python3 -c "import json;print(json.load(open('.fork-ledger/soak-reconcile.json'))['maxLagS'])" 2>/dev/null || echo "?")
PROBLEMS=$(python3 -c "import json;print(len(json.load(open('.fork-ledger/soak-reconcile.json'))['problems']))" 2>/dev/null || echo "?")
END=$(date -u +%FT%TZ); ELAPSED=$(( $(date +%s) - START_TS ))
VERDICT=$([ "$CHECK" -eq 0 ] && [ "${TICKS_FAIL:-0}" -eq 0 ] && echo "MET" || echo "NOT MET")

SUMMARY="### M3 soak summary (written by scripts/fork-soak.sh)
- Window: $START → $END (${ELAPSED}s of ${DURATION_S}s planned), $COINS coins, trade every ${RATE_MS} ms, keeper settle interval ${SETTLE_INTERVAL_MS} ms
- Trades: ${TRADES:-?} (${TRADE_ERRS:-?} errors) · keeper ticks ok/failed: ${TICKS_OK:-0}/${TICKS_FAIL:-0} · per-coin failures: ${COIN_FAILS:-0}
- Settles: $SETTLES · payouts: $PAYOUTS · reconciler problems: $PROBLEMS (exit $CHECK) · max per-coin trade→settle lag: ${MAXLAG}s
- Final /healthz: $HEALTH
- **Definition of done: $VERDICT** (ledger rows match chain: $([ "$CHECK" -eq 0 ] && echo yes || echo NO); unattended for ${ELAPSED}s)"
echo "$SUMMARY"
python3 - "$SUMMARY" <<'PY'
import sys
summary = sys.argv[1]
for p, anchor in (("STATUS.md", "## Milestone 3 — Keeper"), ("keeper/MILESTONE.md", "## How to run")):
    s = open(p).read()
    if "### M3 soak summary" in s:
        import re; s = re.sub(r"### M3 soak summary.*?(?=\n## |\Z)", summary + "\n", s, flags=re.S)
    else:
        s = s.replace(anchor, summary + "\n\n" + anchor, 1)
    open(p, "w").write(s)
PY
kill "$(cat .fork-ledger/validator.pid)" 2>/dev/null
echo "soak done: $VERDICT"

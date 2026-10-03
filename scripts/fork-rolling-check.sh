#!/usr/bin/env bash
# Rolling reconciler for soaks on solana-test-validator, which retains only ~60 slots of history: every INTERVAL_S run
# fork:check over the window since the previous run and accumulate into .fork-ledger/soak-rolling.json, which the final
# fork:check merges into the summary. RPC use is logged (calls per window) so the soak summary can show its footprint.
# Usage: nohup scripts/fork-rolling-check.sh > .fork-ledger/soak-rolling.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}:$PATH"
export DATABASE_URL="${DATABASE_URL:-postgres://satpad:satpad@127.0.0.1:55433/satpad}"
INTERVAL_S="${INTERVAL_S:-20}"
ACC=.fork-ledger/soak-rolling.json
[ -f "$ACC" ] || echo '{"windows":0,"settles":0,"payouts":0,"problems":0,"problemSamples":[],"maxLagS":0,"ledgerRowsChecked":0,"startedAt":"'"$(date -u +%FT%TZ)"'"}' > "$ACC"
LAST=$(solana -u http://127.0.0.1:8899 slot 2>/dev/null || echo 0)
while pgrep -f "scripts/fork-soak.sh" >/dev/null; do
  NOW=$(solana -u http://127.0.0.1:8899 slot 2>/dev/null || echo "$LAST")
  if pnpm -s fork:check --since-slot "$LAST" --json .fork-ledger/soak-window.json > .fork-ledger/soak-window.log 2>&1; then OK=1; else OK=0; fi
  python3 - "$ACC" .fork-ledger/soak-window.json "$OK" "$LAST" "$NOW" <<'PY'
import json, sys, datetime
acc = json.load(open(sys.argv[1]))
try: w = json.load(open(sys.argv[2]))
except Exception: w = {"settles": 0, "payouts": 0, "problems": ["window check crashed"], "maxLagS": 0, "ledgerRowsChecked": 0}
w.pop("rolling", None)
acc["windows"] += 1
acc["settles"] += w.get("settles", 0); acc["payouts"] += w.get("payouts", 0); acc["ledgerRowsChecked"] += w.get("ledgerRowsChecked", 0)
probs = w.get("problems", [])
acc["problems"] += len(probs); acc["problemSamples"] = (acc["problemSamples"] + probs)[:20]
acc["maxLagS"] = max(acc.get("maxLagS") or 0, w.get("maxLagS") or 0)
acc["lastWindow"] = {"sinceSlot": int(sys.argv[4]), "toSlot": int(sys.argv[5]), "at": datetime.datetime.utcnow().isoformat() + "Z", "settles": w.get("settles", 0), "problems": len(probs)}
json.dump(acc, open(sys.argv[1], "w"), indent=1)
print(json.dumps({"window": acc["windows"], "since": int(sys.argv[4]), "to": int(sys.argv[5]), "settles": w.get("settles", 0), "payouts": w.get("payouts", 0), "problems": len(probs), "totalSettles": acc["settles"], "totalProblems": acc["problems"]}))
PY
  LAST=$NOW
  sleep "$INTERVAL_S"
done
echo "soak ended; rolling check stopped"

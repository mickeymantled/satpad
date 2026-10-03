import type { Stats } from "@/lib/api";
import { btc, tokens, usd } from "@/lib/format";

export function StatsBar({ s }: { s: Stats }) {
  const items = [
    ["Coins launched", String(s.coinsLaunched)],
    ["BTC into liquidity", btc(s.btcIntoLiquidity.base, 6)],
    ["$SATPAD burned", tokens(s.satpadBurned.base)],
    ["BTC paid to holders", btc(s.btcPaidToHolders.base, 6)],
    ["BTC traded today", btc(s.btcTradedToday.base, 6)],
    ["BTC / USD", usd({ base: "100000000", ui: "1", usd: (Number(s.btcUsd.cents) / 100).toFixed(2) })],
  ];
  return (
    <div className="card grid grid-cols-2 md:grid-cols-6 divide-x" style={{ borderColor: "var(--border)" }} data-testid="stats-bar">
      {items.map(([k, v]) => (
        <div key={k} className="px-4 py-3"><div className="text-xs" style={{ color: "var(--muted)" }}>{k}</div><div className="num font-medium">{v}</div></div>
      ))}
    </div>
  );
}

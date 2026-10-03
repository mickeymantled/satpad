import Link from "next/link";
import type { CoinSummary } from "@/lib/api";
import { ago, short, usdCompact } from "@/lib/format";
import { coinUrl } from "@/lib/links";
import { Money } from "./Money";
import { StageBadge } from "./StageBadge";

export function CoinCard({ c }: { c: CoinSummary }) {
  return (
    <Link href={coinUrl(c.mint)} className="card p-4 flex flex-col gap-3 hover:[background:var(--bg-hover)]" data-testid="coin-card" data-mint={c.mint} data-stage={c.stage}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{c.name ?? short(c.mint)}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>{c.symbol ? `$${c.symbol}` : short(c.mint)} · {ago(c.createdAt)}</div>
        </div>
        <StageBadge stage={c.stage} progressBps={c.curveProgressBps} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><div className="text-xs" style={{ color: "var(--muted)" }}>Market cap</div><Money a={c.mcap} /></div>
        <div><div className="text-xs" style={{ color: "var(--muted)" }}>24h volume</div><Money a={c.volume24h} /></div>
      </div>
      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
        <span className="num">{c.buys} buys · {c.sells} sells</span>
        <span className="num">{c.holderCount} holders</span>
        {c.paysHolders && <span className="badge" style={{ color: "var(--accent)" }}>pays holders</span>}
        <span className="ml-auto num">{usdCompact(c.mcap)}</span>
      </div>
    </Link>
  );
}

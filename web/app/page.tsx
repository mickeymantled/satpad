import Link from "next/link";
import { Suspense } from "react";
import { api, type CoinSort, type Stage } from "@/lib/api";
import { coinUrl } from "@/lib/links";
import { CoinCard } from "@/components/CoinCard";
import { CoinFilters } from "@/components/CoinFilters";
import { LiveTicker } from "@/components/LiveTicker";
import { Money } from "@/components/Money";
import { StageBadge } from "@/components/StageBadge";
import { StatsBar } from "@/components/StatsBar";

export const dynamic = "force-dynamic";
const SORTS: CoinSort[] = ["volume24h", "newest", "mcap", "trending", "pays_holders"];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const sort = SORTS.includes(sp["sort"] as CoinSort) ? (sp["sort"] as CoinSort) : "volume24h";
  const stage = ["dust", "mining", "block"].includes(sp["stage"] ?? "") ? (sp["stage"] as Stage) : undefined;
  const paysHolders = sp["pays_holders"] === "true";
  const noStore = { cache: "no-store" as const };
  const [grid, hero, newest, stats] = await Promise.all([
    api.coins({ sort, ...(stage && { stage }), paysHolders, limit: 48 }, noStore).catch(() => null),
    api.coins({ sort: "mcap", limit: 1 }, noStore).catch(() => null),
    api.coins({ sort: "newest", limit: 8 }, noStore).catch(() => null),
    api.stats(noStore).catch(() => null),
  ]);
  if (!grid || !stats) return <section className="card p-6">The API is unreachable. Check <code>NEXT_PUBLIC_API_URL</code>.</section>;
  const top = hero?.coins[0];
  const symbols = Object.fromEntries([...grid.coins, ...(newest?.coins ?? [])].map((c) => [c.mint, c.symbol]));
  return (
    <div className="space-y-6">
      {top && (
        <Link href={coinUrl(top.mint)} className="card p-6 flex flex-col md:flex-row md:items-center gap-6" data-testid="hero">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Biggest coin</div>
            <div className="text-3xl font-semibold mt-1">{top.name ?? top.mint} <span className="text-lg" style={{ color: "var(--muted)" }}>{top.symbol ? `$${top.symbol}` : ""}</span></div>
            <div className="mt-2"><StageBadge stage={top.stage} progressBps={top.curveProgressBps} /></div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div><div className="text-xs" style={{ color: "var(--muted)" }}>Market cap</div><Money a={top.mcap} /></div>
            <div><div className="text-xs" style={{ color: "var(--muted)" }}>24h volume</div><Money a={top.volume24h} /></div>
          </div>
        </Link>
      )}
      <StatsBar s={stats} />
      <LiveTicker symbols={symbols} />
      {newest && newest.coins.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>Just launched</h2>
          <div className="flex gap-2 overflow-x-auto" data-testid="just-launched">
            {newest.coins.map((c) => <Link key={c.mint} href={coinUrl(c.mint)} className="btn text-sm whitespace-nowrap">{c.symbol ? `$${c.symbol}` : c.mint.slice(0, 6)} <StageBadge stage={c.stage} /></Link>)}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <Suspense><CoinFilters /></Suspense>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="coin-grid" data-count={grid.coins.length}>
          {grid.coins.map((c) => <CoinCard key={c.mint} c={c} />)}
        </div>
        {grid.coins.length === 0 && <p style={{ color: "var(--muted)" }}>No coins match.</p>}
      </section>
    </div>
  );
}

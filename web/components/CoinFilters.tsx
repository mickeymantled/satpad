"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { CoinSort, Stage } from "@/lib/api";

const STAGES: { key: Stage | "pays_holders" | ""; label: string }[] = [{ key: "", label: "All" }, { key: "dust", label: "Dust" }, { key: "mining", label: "Mining" }, { key: "block", label: "Block" }, { key: "pays_holders", label: "Pays holders" }];
const SORTS: { key: CoinSort; label: string }[] = [{ key: "volume24h", label: "24h volume" }, { key: "newest", label: "Newest" }, { key: "mcap", label: "Market cap" }, { key: "trending", label: "Trending" }, { key: "pays_holders", label: "Pays holders" }];

export function CoinFilters() {
  const sp = useSearchParams(); const path = usePathname();
  const stage = sp.get("stage") ?? (sp.get("pays_holders") === "true" ? "pays_holders" : "");
  const sort = (sp.get("sort") as CoinSort | null) ?? "volume24h";
  const href = (next: { stage?: string; sort?: string }) => {
    const p = new URLSearchParams();
    const st = next.stage ?? stage, so = next.sort ?? sort;
    if (st === "pays_holders") p.set("pays_holders", "true"); else if (st) p.set("stage", st);
    if (so !== "volume24h") p.set("sort", so);
    const q = p.toString(); return q ? `${path}?${q}` : path;
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="coin-filters">
      {STAGES.map((s) => <Link key={s.key} href={href({ stage: s.key })} className="btn text-sm" aria-current={stage === s.key ? "true" : undefined} style={stage === s.key ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>{s.label}</Link>)}
      <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>Sort</span>
      <select className="input w-auto text-sm" value={sort} onChange={(e) => { window.location.href = href({ sort: e.target.value }); }} aria-label="Sort">
        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </div>
  );
}

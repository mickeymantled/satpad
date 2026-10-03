"use client";
import Link from "next/link";
import { useLive } from "@/lib/live";
import { btc, short } from "@/lib/format";
import { coinUrl } from "@/lib/links";

/** SPEC: live trades ticker in BTC on the home page. */
export function LiveTicker({ symbols }: { symbols: Record<string, string | null> }) {
  const { events, connected } = useLive(30);
  return (
    <div className="card px-3 py-2 flex items-center gap-3 overflow-hidden text-sm" data-testid="live-ticker" data-connected={connected}>
      <span className="badge" style={{ color: connected ? "var(--green)" : "var(--muted)" }}>{connected ? "live" : "connecting"}</span>
      <div className="flex gap-4 overflow-x-auto whitespace-nowrap">
        {events.length === 0 && <span style={{ color: "var(--muted)" }}>Waiting for trades…</span>}
        {events.map((e, i) => e.kind === "trade" ? (
          <Link key={`${e.signature}-${i}`} href={coinUrl(e.mint)} className="num" style={{ color: e.side === "buy" ? "var(--green)" : "var(--red)" }}>
            {e.side === "buy" ? "▲" : "▼"} {symbols[e.mint] ? `$${symbols[e.mint]}` : short(e.mint)} {btc(e.btc, 6)}
          </Link>
        ) : e.kind === "coin" ? (
          <Link key={`${e.mint}-${i}`} href={coinUrl(e.mint)} style={{ color: "var(--accent)" }}>✦ new {e.symbol ? `$${e.symbol}` : short(e.mint)}</Link>
        ) : null)}
      </div>
    </div>
  );
}

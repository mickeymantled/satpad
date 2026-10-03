"use client";
// Curve price chart from indexed trades (lightweight-charts, D19). Price = BTC base units per whole token, scaled 1e12
// in the API; shown here in sats per token.
import { useEffect, useRef } from "react";
import type { Trade } from "@/lib/api";

export function PriceChart({ trades }: { trades: Trade[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || trades.length === 0) return;
    let dispose = () => {};
    void (async () => {
      const { createChart, LineSeries, ColorType } = await import("lightweight-charts");
      const chart = createChart(ref.current!, { height: 260, layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b94a7" }, grid: { vertLines: { color: "#242a36" }, horzLines: { color: "#242a36" } }, rightPriceScale: { borderColor: "#242a36" }, timeScale: { borderColor: "#242a36", timeVisible: true, secondsVisible: false } });
      const series = chart.addSeries(LineSeries, { color: "#f7931a", lineWidth: 2, priceFormat: { type: "custom", minMove: 0.000001, formatter: (v: number) => `${v.toFixed(6)} sats` } });
      const seen = new Set<number>();
      const points = [...trades].reverse().flatMap((t) => {
        if (!t.time) return [];
        const time = Math.floor(new Date(t.time).getTime() / 1000);
        if (seen.has(time)) return []; seen.add(time);
        return [{ time: time as unknown as import("lightweight-charts").UTCTimestamp, value: Number(BigInt(t.priceBtcScaled)) / 1e12 }];
      }).sort((a, b) => (a.time as number) - (b.time as number));
      series.setData(points);
      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 600 }));
      ro.observe(ref.current!);
      dispose = () => { ro.disconnect(); chart.remove(); };
    })();
    return () => dispose();
  }, [trades]);
  if (trades.length === 0) return <div className="card h-[260px] flex items-center justify-center text-sm" style={{ color: "var(--muted)" }}>No trades yet</div>;
  return <div ref={ref} className="card p-2" data-testid="price-chart" />;
}

import type { Amount } from "@/lib/api";
import { btc, sats, usd } from "@/lib/format";

/** BTC with sats and USD alongside (SPEC "every number in BTC with sats and USD alongside"). */
export function Money({ a, className = "" }: { a: Amount; className?: string }) {
  return (
    <span className={`num inline-flex flex-col leading-tight ${className}`}>
      <span>{btc(a.base)}</span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>{sats(a.base)} · {usd(a)}</span>
    </span>
  );
}

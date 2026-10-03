"use client";
import { useState } from "react";
import type { Holder, Trade } from "@/lib/api";
import { ago, btc, short, tokens } from "@/lib/format";
import { explorerAccount, explorerTx } from "@/lib/links";

export function CoinTabs({ trades, holders, symbol }: { trades: Trade[]; holders: Holder[]; symbol: string | null }) {
  const [tab, setTab] = useState<"trades" | "holders">("trades");
  return (
    <div className="card" data-testid="coin-tabs">
      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
        {(["trades", "holders"] as const).map((t) => <button key={t} className="px-4 py-2 text-sm capitalize" style={tab === t ? { color: "var(--accent)", borderBottom: "2px solid var(--accent)" } : { color: "var(--muted)" }} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>)}
      </div>
      {tab === "trades" ? (
        <table className="w-full text-sm num"><tbody>
          {trades.map((t) => (
            <tr key={t.signature} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="px-3 py-2" style={{ color: t.side === "buy" ? "var(--green)" : "var(--red)" }}>{t.side}</td>
              <td className="px-3 py-2">{btc(t.btc.base)}</td><td className="px-3 py-2">{tokens(t.tokens.base)} {symbol ?? ""}</td>
              <td className="px-3 py-2"><a href={explorerAccount(t.trader)} target="_blank" rel="noreferrer">{short(t.trader)}</a></td>
              <td className="px-3 py-2" style={{ color: "var(--muted)" }}>{ago(t.time)}</td>
              <td className="px-3 py-2"><a href={explorerTx(t.signature)} target="_blank" rel="noreferrer" style={{ color: "var(--muted)" }}>tx ↗</a></td>
            </tr>
          ))}
          {trades.length === 0 && <tr><td className="px-3 py-3" style={{ color: "var(--muted)" }}>No trades yet</td></tr>}
        </tbody></table>
      ) : (
        <table className="w-full text-sm num"><tbody>
          {holders.map((h) => <tr key={h.wallet} className="border-b" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2"><a href={explorerAccount(h.wallet)} target="_blank" rel="noreferrer">{short(h.wallet, 6)}</a></td><td className="px-3 py-2">{tokens(h.balance.base)} {symbol ?? ""}</td></tr>)}
          {holders.length === 0 && <tr><td className="px-3 py-3" style={{ color: "var(--muted)" }}>No holders yet</td></tr>}
        </tbody></table>
      )}
    </div>
  );
}

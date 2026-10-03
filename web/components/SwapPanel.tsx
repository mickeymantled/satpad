"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { btc, sats } from "@/lib/format";
import { loadSolSwapper, type SolSwapper } from "@/lib/swap";

/** "Get BTC with SOL": shown wherever a wallet needs BTC on Solana. */
export function SwapPanel({ onDone }: { onDone?: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [swapper, setSwapper] = useState<SolSwapper | null | undefined>(undefined);
  const [sol, setSol] = useState("0.5");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { loadSolSwapper().then(setSwapper); }, []);
  useEffect(() => {
    const l = toLamports(sol);
    if (!swapper || l === null) { setQuote(null); return; }
    swapper.quote(l).then(setQuote).catch(() => setQuote(null));
  }, [sol, swapper]);
  if (swapper === undefined) return null;
  if (swapper === null) return <div className="text-xs" style={{ color: "var(--muted)" }}>SOL → BTC swap unavailable on this network.</div>;
  const run = async () => {
    const l = toLamports(sol);
    if (!l || !wallet.publicKey || !wallet.signTransaction) return;
    setError("");
    try {
      await swapper.swap(connection, { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction }, l, setStatus);
      onDone?.();
    } catch (e) { setError((e as Error).message); setStatus(""); }
  };
  return (
    <div className="card p-3 space-y-2" data-testid="swap-panel" data-kind={swapper.kind}>
      <div className="text-sm font-medium">Get BTC with SOL {swapper.kind === "dev-faucet" && <span className="badge" style={{ color: "var(--red)" }}>dev faucet</span>}</div>
      <input className="input num" inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value)} data-testid="swap-sol" />
      {quote !== null && <div className="text-xs num" style={{ color: "var(--muted)" }} data-testid="swap-quote">≈ {btc(quote)} ({sats(quote)})</div>}
      {status && <div className="text-xs" style={{ color: "var(--muted)" }} data-testid="swap-status">{status}</div>}
      {error && <div className="text-xs" style={{ color: "var(--red)" }}>{error}</div>}
      <button className="btn btn-accent w-full" disabled={!wallet.publicKey || quote === null || (Boolean(status) && status !== "confirmed")} onClick={run} data-testid="swap-submit">Swap SOL → BTC</button>
    </div>
  );
}
function toLamports(s: string): bigint | null {
  const m = /^(\d*)(?:\.(\d{0,9}))?$/.exec(s.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const v = BigInt(m[1] || "0") * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
  return v > 0n ? v : null;
}

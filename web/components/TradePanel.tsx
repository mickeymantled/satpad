"use client";
// Buy/sell on the bonding curve (SPEC /coin): quotes from the SDK curve math on live curve state, slippage in sats,
// every tx simulated and previewed. The quote ATA is created idempotently so first-time sellers/buyers never fail
// on a missing account. "Buy with native BTC" opens the bridge (M8).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda, type BondingCurve, type FeeConfig, type Global, type QuoteControl } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, buildBuyV2, buildSellV2, coinFeePda, defaultFeeRecipients, parseBtc, quoteSatsForSell, quoteSatsForTokens, quoteTokensForSats, sats as toSats, toUi } from "@satpad/sdk";
import { btc, sats as fmtSats, tokens as fmtTokens } from "@/lib/format";
import { useTx } from "@/lib/useTx";
import { TxPreviewModal } from "./TxPreviewModal";
import { env } from "@/lib/env";

interface CurveState { global: Global; feeConfig: FeeConfig; quoteControl: QuoteControl | null; curve: BondingCurve; supply: bigint }

export function TradePanel({ mint, symbol }: { mint: string; symbol: string | null }) {
  const { connection } = useConnection();
  const tx = useTx();
  const mintPk = new PublicKey(mint);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [state, setState] = useState<CurveState | null>(null);
  const [balances, setBalances] = useState<{ wbtc: bigint; coin: bigint } | null>(null);
  const [quote, setQuote] = useState<{ out: bigint; in: bigint } | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    const online = new OnlinePumpSdk(connection);
    const [global, feeConfig, quoteControl, info] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl(), connection.getAccountInfo(bondingCurvePda(mintPk), "confirmed")]);
    if (!info) throw new Error("bonding curve not found");
    const curve = PUMP_SDK.decodeBondingCurve(info);
    setState({ global, feeConfig, quoteControl, curve, supply: BigInt(curve.tokenTotalSupply.toString()) });
    if (tx.publicKey) {
      const wb = await getAccount(connection, getAssociatedTokenAddressSync(BTC_QUOTE_MINT, tx.publicKey, true, BTC_QUOTE_TOKEN_PROGRAM), "confirmed", BTC_QUOTE_TOKEN_PROGRAM).then((a) => a.amount).catch(() => 0n);
      const cb = await getAccount(connection, getAssociatedTokenAddressSync(mintPk, tx.publicKey, true, COIN_TOKEN_PROGRAM), "confirmed", COIN_TOKEN_PROGRAM).then((a) => a.amount).catch(() => 0n);
      setBalances({ wbtc: wb, coin: cb });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, mint, tx.publicKey]);
  useEffect(() => { refresh().catch((e) => setErr((e as Error).message)); const t = setInterval(() => refresh().catch(() => {}), 10_000); return () => clearInterval(t); }, [refresh]);

  useEffect(() => {
    setErr("");
    if (!state || !input) { setQuote(null); return; }
    try {
      const inputs = { global: state.global, feeConfig: state.feeConfig, mintSupply: state.supply, bondingCurve: state.curve, quoteControl: state.quoteControl };
      if (side === "buy") {
        const spend = parseBtc(input);
        const out = quoteTokensForSats(inputs, spend);
        if (out <= 0n) throw new Error("amount too small");
        setQuote({ in: quoteSatsForTokens(inputs, out), out });
      } else {
        const amount = BigInt(Math.round(Number(input) * 1e6)); // token input (6 decimals) — display precision only
        if (amount <= 0n) throw new Error("amount too small");
        setQuote({ in: amount, out: quoteSatsForSell({ ...inputs, mintSupply: state.supply, bondingCurve: state.curve }, amount) });
      }
    } catch (e) { setQuote(null); setErr((e as Error).message); }
  }, [input, side, state]);

  const submit = async () => {
    if (!state || !quote || !tx.publicKey) return;
    const recipients = defaultFeeRecipients(state.global);
    const [coinFee] = coinFeePda(mintPk);
    const quoteAta = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, tx.publicKey, true, BTC_QUOTE_TOKEN_PROGRAM);
    const ensureQuoteAta: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(tx.publicKey, quoteAta, tx.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM);
    const slip = BigInt(slippageBps);
    const ixs = side === "buy"
      ? [ensureQuoteAta, ...(await buildBuyV2({ user: tx.publicKey, mint: mintPk, creator: coinFee, recipients, tokenAmount: quote.out, maxQuoteIn: toSats((quote.in * (10_000n + slip)) / 10_000n + 1n) }))]
      : [ensureQuoteAta, await buildSellV2({ user: tx.publicKey, mint: mintPk, creator: coinFee, recipients, tokenAmount: quote.in, minQuoteOut: toSats((quote.out * (10_000n - slip)) / 10_000n) })];
    try { await tx.send(side === "buy" ? `Buy ${symbol ?? "coin"}` : `Sell ${symbol ?? "coin"}`, ixs); setInput(""); await refresh(); } catch { /* shown via tx.error */ }
  };

  const canSwapSol = env.devSwap; // production path arrives with the Jupiter task
  return (
    <div className="card p-4 space-y-3" data-testid="trade-panel">
      {tx.preview && <TxPreviewModal preview={tx.preview.p} title={tx.preview.title} onConfirm={() => tx.preview?.resolve(true)} onCancel={() => tx.preview?.resolve(false)} />}
      <div className="flex gap-2">
        <button className={`btn flex-1 ${side === "buy" ? "btn-accent" : ""}`} onClick={() => { setSide("buy"); setInput(""); }} data-testid="side-buy">Buy</button>
        <button className={`btn flex-1 ${side === "sell" ? "btn-accent" : ""}`} onClick={() => { setSide("sell"); setInput(""); }} data-testid="side-sell">Sell</button>
      </div>
      <label className="block text-xs" style={{ color: "var(--muted)" }}>{side === "buy" ? "Spend (BTC)" : `Sell (${symbol ?? "tokens"})`}</label>
      <input className="input num" inputMode="decimal" placeholder={side === "buy" ? "0.0001" : "1000"} value={input} onChange={(e) => setInput(e.target.value)} data-testid="trade-amount" />
      {balances && <div className="text-xs num" style={{ color: "var(--muted)" }}>Balance: {btc(balances.wbtc)} · {fmtTokens(balances.coin)} {symbol ?? ""}</div>}
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
        <span>Slippage</span>
        {[50, 100, 300].map((b) => <button key={b} className="btn px-2 py-1" style={slippageBps === b ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setSlippageBps(b)}>{b / 100}%</button>)}
      </div>
      {quote && (
        <div className="text-sm num" data-testid="trade-quote">
          {side === "buy" ? <>You receive ≈ <b>{fmtTokens(quote.out)} {symbol ?? ""}</b> for {fmtSats(quote.in)} ({btc(quote.in)})</> : <>You receive ≈ <b>{btc(quote.out)}</b> ({fmtSats(quote.out)}) for {fmtTokens(quote.in)} {symbol ?? ""}</>}
        </div>
      )}
      {err && <div className="text-xs" style={{ color: "var(--red)" }}>{err}</div>}
      {tx.error && <div className="text-xs" style={{ color: "var(--red)" }} data-testid="tx-error">{tx.error}</div>}
      {tx.status && <div className="text-xs" style={{ color: "var(--muted)" }} data-testid="tx-status">{tx.status}</div>}
      {tx.signature && <div className="text-xs num" data-testid="tx-signature">confirmed {tx.signature.slice(0, 16)}…</div>}
      <button className="btn btn-accent w-full" disabled={!tx.connected || !quote || Boolean(tx.status && tx.status !== "confirmed")} onClick={submit} data-testid="trade-submit">
        {!tx.connected ? "Connect wallet" : side === "buy" ? "Buy" : "Sell"}
      </button>
      {balances && balances.wbtc === 0n && side === "buy" && (
        <div className="text-xs" style={{ color: "var(--muted)" }}>No BTC on Solana yet. {canSwapSol ? <span>Use the SOL swap (task 6).</span> : <Link href="/btc" className="underline">Bring native BTC</Link>}.</div>
      )}
      <Link href={`/btc?to=${mint}`} className="btn w-full text-sm">Buy with native BTC</Link>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>Creator fee 1% in BTC → 25% Reserve · 25% buyback · 10% operator · 40% deployer or holders. {toUi(1n)}</p>
    </div>
  );
}

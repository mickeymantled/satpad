"use client";
// SPEC /launch: name, symbol, image, description, socials, payee choice (Me / Wallet / Holders), optional first buy.
// Simulates the full transaction and shows every instruction before the wallet prompt (useTx → TxPreviewModal).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, parseBtc, type PayeeChoice } from "@satpad/sdk";
import { api } from "@/lib/api";
import { btc, tokens as fmtTokens } from "@/lib/format";
import { buildLaunchIxs, loadLaunchContext, planLaunch, quoteFirstBuy, validateLaunchForm, type LaunchContext, type LaunchPlan } from "@/lib/launch";
import { useTx } from "@/lib/useTx";
import { SwapPanel } from "./SwapPanel";
import { TxPreviewModal } from "./TxPreviewModal";

function sol(lamports: bigint): string { const s = lamports.toString().padStart(10, "0"); return `${s.slice(0, -9)}.${s.slice(-9).replace(/0+$/, "") || "0"} SOL`; }
type PayeeKind = "me" | "wallet" | "holders";

export function LaunchForm() {
  const { connection } = useConnection();
  const router = useRouter();
  const tx = useTx();
  const [ctx, setCtx] = useState<LaunchContext | null>(null);
  const [ctxErr, setCtxErr] = useState("");
  const [f, setF] = useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", image: "", imageName: "", payeeKind: "me" as PayeeKind, payeeWallet: "", firstBuy: "" });
  const [wbtc, setWbtc] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<"" | "uploading" | "sending" | "indexing">("");
  const [err, setErr] = useState("");
  const [launched, setLaunched] = useState<{ mint: string; signature: string } | null>(null);
  const [plan, setPlan] = useState<LaunchPlan["mode"] | "">("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => { loadLaunchContext(connection).then(setCtx).catch((e) => setCtxErr((e as Error).message)); }, [connection]);
  const refreshBalance = useCallback(async () => {
    if (!tx.publicKey) { setWbtc(null); return; }
    const a = getAssociatedTokenAddressSync(BTC_QUOTE_MINT, tx.publicKey, true, BTC_QUOTE_TOKEN_PROGRAM);
    setWbtc(await getAccount(connection, a, "confirmed", BTC_QUOTE_TOKEN_PROGRAM).then((x) => x.amount).catch(() => 0n));
  }, [connection, tx.publicKey]);
  useEffect(() => { refreshBalance().catch(() => {}); }, [refreshBalance]);

  let firstBuySats = 0n, firstBuyErr = "";
  try { firstBuySats = f.firstBuy ? parseBtc(f.firstBuy) : 0n; } catch (e) { firstBuyErr = (e as Error).message; }
  const quote = ctx && firstBuySats > 0n ? quoteFirstBuy(ctx, firstBuySats) : null;
  const needsBtc = quote !== null && wbtc !== null && wbtc < quote.cost;
  const onImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setErr("Image must be under 4 MB"); return; }
    const r = new FileReader(); r.onload = () => setF((p) => ({ ...p, image: String(r.result), imageName: file.name })); r.readAsDataURL(file);
  };

  const submit = async () => {
    setErr("");
    if (!ctx || !tx.publicKey) return;
    const v = validateLaunchForm(f) ?? (firstBuyErr || null) ?? (needsBtc ? "Not enough BTC for the first buy — swap SOL first" : null);
    if (v) { setErr(v); return; }
    const mintKp = Keypair.generate();
    const payee: PayeeChoice = f.payeeKind === "me" ? { kind: "me" } : f.payeeKind === "holders" ? { kind: "holders" } : { kind: "wallet", wallet: new PublicKey(f.payeeWallet.trim()) };
    try {
      setPhase("uploading");
      const meta = await api.uploadMetadata({ name: f.name.trim(), symbol: f.symbol.trim(), description: f.description, image: f.image, twitter: f.twitter, telegram: f.telegram, website: f.website, mint: mintKp.publicKey.toBase58() });
      const base = { user: tx.publicKey, mint: mintKp.publicKey, name: f.name.trim(), symbol: f.symbol.trim(), uri: meta.uri, payee, treasury: ctx.treasury, recipients: ctx.recipients, creatorFeeBps: ctx.creatorFeeBps };
      const createAndDeclare = await buildLaunchIxs(base);
      const firstBuy = quote && quote.tokens > 0n ? (await buildLaunchIxs({ ...base, firstBuy: { tokenAmount: quote.tokens, maxQuoteIn: quote.cost + quote.cost / 100n + 1n } })).slice(createAndDeclare.length) : [];
      // SPEC "Creation (one transaction)" + "Wallet and transactions": one tx when it fits; drop the priority fee near
      // the limit; as a last resort (D20) the first buy follows as its own transaction after the launch confirms.
      const planned = planLaunch(tx.publicKey, createAndDeclare, firstBuy, [ctx.table]);
      setPlan(planned.mode);
      setPhase("sending");
      const res = await tx.send(`Launch ${f.symbol.trim()}`, planned.launch, [ctx.table], [mintKp], { noPriorityFee: planned.mode === "single-no-fee" });
      const mint = mintKp.publicKey.toBase58();
      setLaunched({ mint, signature: res.signature });
      if (planned.firstBuy.length) await tx.send(`First buy ${f.symbol.trim()}`, planned.firstBuy, [ctx.table]);
      setPhase("indexing");
      for (let i = 0; i < 90; i++) { // wait for the indexer, then open the coin page
        if (await api.coin(mint, { cache: "no-store" }).then(() => true).catch(() => false)) { router.push(`/coin/${mint}`); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setPhase("");
    } catch (e) { setErr((e as Error).message); setPhase(""); }
  };

  const busy = phase !== "" || Boolean(tx.status && tx.status !== "confirmed");
  return (
    <div className="card p-5 space-y-4 max-w-2xl" data-testid="launch-form">
      {tx.preview && <TxPreviewModal preview={tx.preview.p} title={tx.preview.title} onConfirm={() => tx.preview?.resolve(true)} onCancel={() => tx.preview?.resolve(false)} />}
      {ctxErr && <div className="text-xs" style={{ color: "var(--red)" }}>{ctxErr}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-sm"><span>Name <span style={{ color: "var(--muted)" }}>(≤ 32 bytes)</span></span><input className="input w-full" value={f.name} onChange={set("name")} maxLength={32} data-testid="launch-name" /></label>
        <label className="space-y-1 text-sm"><span>Symbol</span><input className="input w-full" value={f.symbol} onChange={set("symbol")} maxLength={10} data-testid="launch-symbol" /></label>
      </div>
      <label className="space-y-1 text-sm block"><span>Image <span style={{ color: "var(--muted)" }}>(png / jpeg / gif / webp, &lt; 4 MB)</span></span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onImage} data-testid="launch-image" />{f.imageName && <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>{f.imageName}</span>}</label>
      <label className="space-y-1 text-sm block"><span>Description <span style={{ color: "var(--muted)" }}>(ends with “Launched on satpad”)</span></span><textarea className="input w-full" rows={3} value={f.description} onChange={set("description")} data-testid="launch-description" /></label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1 text-xs"><span>Twitter</span><input className="input w-full" placeholder="https://x.com/…" value={f.twitter} onChange={set("twitter")} /></label>
        <label className="space-y-1 text-xs"><span>Telegram</span><input className="input w-full" placeholder="https://t.me/…" value={f.telegram} onChange={set("telegram")} /></label>
        <label className="space-y-1 text-xs"><span>Website <span style={{ color: "var(--muted)" }}>(empty = coin page)</span></span><input className="input w-full" placeholder="https://…" value={f.website} onChange={set("website")} /></label>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Deployer share (40% of creator fees) goes to</legend>
        {([["me", "Me — this wallet"], ["wallet", "Another wallet"], ["holders", "Holders — paid pro rata, permanent"]] as [PayeeKind, string][]).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2"><input type="radio" name="payee" checked={f.payeeKind === k} onChange={() => setF((p) => ({ ...p, payeeKind: k }))} data-testid={`launch-payee-${k}`} />{label}</label>
        ))}
        {f.payeeKind === "wallet" && <input className="input w-full num" placeholder="wallet address" value={f.payeeWallet} onChange={set("payeeWallet")} data-testid="launch-payee-address" />}
      </fieldset>
      <div className="space-y-1 text-sm">
        <label className="block"><span>First buy in BTC <span style={{ color: "var(--muted) " }}>(optional)</span></span><input className="input w-full num" inputMode="decimal" placeholder="0.0001" value={f.firstBuy} onChange={set("firstBuy")} data-testid="launch-first-buy" /></label>
        {wbtc !== null && <div className="text-xs num" style={{ color: "var(--muted)" }} data-testid="launch-balance">Balance: {btc(wbtc)}</div>}
        {firstBuyErr && <div className="text-xs" style={{ color: "var(--red)" }}>{firstBuyErr}</div>}
        {quote && <div className="text-xs num" style={{ color: "var(--muted)" }} data-testid="launch-quote">You receive ≈ {fmtTokens(quote.tokens)} tokens for {btc(quote.cost)}</div>}
        {needsBtc && <SwapPanel onDone={refreshBalance} />}
      </div>
      {ctx && <div className="text-xs num" style={{ color: "var(--muted)" }}>Launch fee {sol(ctx.launchFeeLamports)} to the treasury · creator fee {ctx.creatorFeeBps / 100}% in BTC · metadata via {ctx.metadataBackend === "pump" ? "pump.fun IPFS" : "satpad"}</div>}
      {(err || tx.error) && <div className="text-xs" style={{ color: "var(--red)" }} data-testid="tx-error">{err || tx.error}{tx.logs.length > 0 && <pre className="whitespace-pre-wrap text-[10px]" data-testid="tx-logs">{tx.logs.filter((l) => l.includes("Program log") || l.includes("failed")).slice(-12).join("\n")}</pre>}</div>}
      {(phase || tx.status) && <div className="text-xs" style={{ color: "var(--muted)" }} data-testid="tx-status">{phase === "indexing" ? "launched — waiting for the indexer" : phase === "uploading" ? "uploading metadata" : tx.status}</div>}
      {plan && plan !== "single" && <div className="text-xs" style={{ color: "var(--muted)" }} data-testid="launch-plan" data-mode={plan}>{plan === "single-no-fee" ? "At the size limit: this launch runs without a priority fee." : "At the size limit: the first buy follows as a second transaction right after the launch confirms."}</div>}
      {launched && <div className="text-xs num" data-testid="launch-done" data-mint={launched.mint} data-signature={launched.signature}>Mint {launched.mint}</div>}
      <button className="btn btn-accent w-full" disabled={!tx.connected || !ctx || busy} onClick={submit} data-testid="launch-submit">{tx.connected ? "Simulate and launch" : "Connect a wallet to launch"}</button>
    </div>
  );
}

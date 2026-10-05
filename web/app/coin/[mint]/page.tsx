import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { explorerAccount } from "@/lib/links";
import { ago, short } from "@/lib/format";
import { CoinTabs } from "@/components/CoinTabs";
import { Money } from "@/components/Money";
import { PriceChart } from "@/components/PriceChart";
import { StageBadge } from "@/components/StageBadge";
import { TradePanel } from "@/components/TradePanel";

export const dynamic = "force-dynamic";

export default async function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const noStore = { cache: "no-store" as const };
  const coin = await api.coin(mint, noStore).catch(() => null);
  if (!coin) notFound();
  const [trades, holders] = await Promise.all([api.trades(mint, { limit: 100 }, noStore), api.holders(mint, { limit: 50 }, noStore)]);
  const links: [string, string][] = [["CoinFee (pump creator)", coin.accounts.coinFee], ["Fee ATA", coin.accounts.coinFeeAta], ["Payee pot", coin.accounts.payeePot], ["Rewards pot", coin.accounts.rewardsPot], ["Bonding curve", coin.bondingCurve], ...(coin.pool ? [["PumpSwap pool", coin.pool] as [string, string]] : [])];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="coin-name">{coin.name ?? short(mint)} <span className="text-base" style={{ color: "var(--muted)" }}>{coin.symbol ? `$${coin.symbol}` : ""}</span></h1>
          <StageBadge stage={coin.stage} progressBps={coin.curveProgressBps} />
          {coin.paysHolders && <span className="badge" style={{ color: "var(--accent)" }} data-testid="rewards-badge">pays holders · {coin.btcPaidToHolders.ui} BTC so far</span>}
          {coin.paused && <span className="badge" style={{ color: "var(--red)" }}>paused</span>}
          <span className="text-xs ml-auto num" style={{ color: "var(--muted)" }}>launched {ago(coin.createdAt)}</span>
        </div>
        <PriceChart trades={trades.trades} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="card p-3"><div className="text-xs" style={{ color: "var(--muted)" }}>Market cap</div><Money a={coin.mcap} /></div>
          <div className="card p-3"><div className="text-xs" style={{ color: "var(--muted)" }}>24h volume</div><Money a={coin.volume24h} /></div>
          <div className="card p-3"><div className="text-xs" style={{ color: "var(--muted)" }}>Creator fees settled</div><Money a={coin.fees.creatorFee} /></div>
          <div className="card p-3"><div className="text-xs" style={{ color: "var(--muted)" }}>Holders · trades</div><div className="num">{coin.holderCount} · {coin.buys + coin.sells}</div></div>
        </div>
        <CoinTabs trades={trades.trades} holders={holders.holders} symbol={coin.symbol} />
      </div>
      <aside className="space-y-4">
        <TradePanel mint={mint} symbol={coin.symbol} pool={coin.pool} />
        <div className="card p-4 text-sm space-y-2" data-testid="fee-accounts">
          <div className="font-medium">Deployer share → {coin.payeeMode === "holders" ? "holders (permanent)" : <a href={explorerAccount(coin.payee)} target="_blank" rel="noreferrer" className="underline num">{short(coin.payee, 6)}</a>}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>Deployer <a href={explorerAccount(coin.deployer)} target="_blank" rel="noreferrer" className="underline num">{short(coin.deployer)}</a></div>
          <ul className="text-xs space-y-1 num">
            {links.map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span style={{ color: "var(--muted)" }}>{k}</span><a href={explorerAccount(v)} target="_blank" rel="noreferrer" className="underline">{short(v, 6)}</a></li>)}
          </ul>
        </div>
      </aside>
    </div>
  );
}

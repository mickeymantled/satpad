export default async function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <section className="space-y-2"><h1 className="text-2xl font-semibold">Coin</h1><p className="num" style={{ color: "var(--muted)" }}>{mint}</p></section>;
}

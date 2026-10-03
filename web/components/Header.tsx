import Link from "next/link";
import { WalletButton } from "./WalletButton";

export function Header() {
  return (
    <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--bg-elev)" }}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight"><span style={{ color: "var(--accent)" }}>₿</span> satpad</Link>
        <nav className="flex gap-4 text-sm" style={{ color: "var(--muted)" }}>
          <Link href="/launch">Launch</Link>
          <Link href="/btc">Move BTC</Link>
          <Link href="/ledger">Ledger</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <div className="ml-auto"><WalletButton /></div>
      </div>
    </header>
  );
}

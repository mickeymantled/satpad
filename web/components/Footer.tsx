/** SPEC "Copy and disclosure": on every page. */
export function Footer() {
  return (
    <footer className="border-t text-xs leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-1">
        <p>Satpad is an independent project, not affiliated with pump.fun or with the issuer of any wrapped bitcoin. Coins can go to zero. The Reserve backs no single coin.</p>
        <p>We never DM first and never ask for your keys. Read the <a href="/docs" className="underline">docs, risks and terms</a> before launching or trading.</p>
      </div>
    </footer>
  );
}

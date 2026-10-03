import { LaunchForm } from "@/components/LaunchForm";

export const metadata = { title: "Launch · satpad" };

export default function Page() {
  return (
    <section className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Launch a coin</h1><p className="text-sm" style={{ color: "var(--muted)" }}>A real pump.fun coin quoted in BTC. One transaction: create, register with the vault, optional first buy. Every instruction is simulated and listed before your wallet asks you to sign.</p></div>
      <LaunchForm />
    </section>
  );
}

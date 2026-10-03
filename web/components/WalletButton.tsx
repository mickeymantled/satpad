"use client";
import dynamic from "next/dynamic";
// The modal button touches `window`; load it client-only to keep the header a server component.
const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });
export function WalletButton() {
  return <div data-testid="wallet-button"><WalletMultiButton /></div>;
}

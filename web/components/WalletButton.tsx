"use client";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
// The modal button touches `window`; load it client-only to keep the header a server component.
const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });
export function WalletButton() {
  const { publicKey } = useWallet();
  return <div data-testid="wallet-button" data-pubkey={publicKey?.toBase58() ?? ""}><WalletMultiButton /></div>;
}

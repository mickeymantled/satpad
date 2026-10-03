"use client";
// Wallet + RPC providers. Phantom, Solflare and Backpack register through Wallet Standard, so no adapter list is
// needed; the unsafe burner is added only on dev/fork builds (NEXT_PUBLIC_DEV_SWAP=1) for Playwright.
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter } from "@solana/wallet-adapter-base";
import { env } from "@/lib/env";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo<Adapter[]>(() => {
    if (!env.devSwap) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UnsafeBurnerWalletAdapter } = require("@solana/wallet-adapter-unsafe-burner") as typeof import("@solana/wallet-adapter-unsafe-burner");
    return [new UnsafeBurnerWalletAdapter()];
  }, []);
  return (
    <ConnectionProvider endpoint={env.rpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

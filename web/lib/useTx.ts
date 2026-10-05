"use client";
// Hook around sendWithWallet: owns the preview modal state and a status line. One in-flight tx at a time.
import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { AddressLookupTableAccount, Signer, TransactionInstruction } from "@solana/web3.js";
import { TxError, sendWithWallet, type Preview, type WalletLike } from "./tx";

export function useTx() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ p: Preview; title: string; note?: string; resolve: (ok: boolean) => void } | null>(null);
  const [signature, setSignature] = useState<string>("");

  const send = useCallback(async (title: string, ixs: TransactionInstruction[], tables?: AddressLookupTableAccount[], extraSigners?: Signer[], opts: { noPriorityFee?: boolean; note?: string } = {}) => {
    if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Connect a wallet first");
    const w: WalletLike = { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction };
    setError(""); setLogs([]); setSignature(""); setStatus("building");
    try {
      const res = await sendWithWallet(connection, w, ixs, {
        ...(tables && { tables }), ...(extraSigners && { extraSigners }), ...(opts.noPriorityFee && { noPriorityFee: true }),
        onStatus: setStatus,
        onPreview: (p) => new Promise<boolean>((resolve) => setPreview({ p, title, ...(opts.note && { note: opts.note }), resolve: (ok) => { setPreview(null); resolve(ok); } })),
      });
      setSignature(res.signature);
      return res;
    } catch (e) {
      setError((e as Error).message); setLogs(e instanceof TxError ? e.logs : []); setStatus("");
      throw e;
    }
  }, [connection, wallet]);

  return { send, status, error, logs, signature, preview, connected: Boolean(wallet.publicKey), publicKey: wallet.publicKey };
}

"use client";
import type { Preview } from "@/lib/tx";

/** SPEC: "Simulates the full transaction and shows every instruction before the wallet prompt." */
export function TxPreviewModal({ preview, title, onConfirm, onCancel }: { preview: Preview; title: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} data-testid="tx-preview">
      <div className="card w-full max-w-lg p-5 space-y-4">
        <h3 className="font-semibold">{title}</h3>
        <ol className="space-y-1 text-sm">
          {preview.instructions.map((i, n) => (
            <li key={n} className="flex gap-2"><span className="num w-5" style={{ color: "var(--muted)" }}>{n + 1}.</span><span className="font-medium">{i.program}</span><span style={{ color: "var(--muted)" }}>{i.summary} · {i.accounts} accounts</span></li>
          ))}
        </ol>
        <div className="text-xs num grid grid-cols-3 gap-2" style={{ color: "var(--muted)" }}>
          <span>Compute: {preview.unitsConsumed.toLocaleString()} CU</span><span>Priority fee: {preview.priorityFeeMicroLamports.toString()} µ-lamports/CU</span><span>Size: {preview.sizeBytes} B</span>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel} data-testid="tx-cancel">Cancel</button>
          <button className="btn btn-accent" onClick={onConfirm} data-testid="tx-confirm">Sign in wallet</button>
        </div>
      </div>
    </div>
  );
}

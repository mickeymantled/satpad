// Helius raw-webhook receiver (VERIFIED V8): POST of a JSON array of transactions, `Authorization` header equal to
// the webhook's authHeader, must answer 200 within 1 s → we parse, validate, enqueue, and ack; processing is async.
// Duplicates and lost events are expected; the polling source reconciles.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fromHeliusRaw, type HeliusRawTx, type NormalizedTx } from "../decode";
import type { TxSink } from "./types";

export interface WebhookOptions { authHeader: string; maxBodyBytes?: number; log?: (msg: string, f?: Record<string, unknown>) => void }

export class WebhookQueue {
  private queue: NormalizedTx[] = [];
  private draining: Promise<void> | null = null;
  received = 0; handled = 0; rejected = 0; invalid = 0;
  constructor(private readonly sink: TxSink, private readonly opts: WebhookOptions) {}

  /** Validates and enqueues one request body. Returns the HTTP status to answer with. */
  accept(authorization: string | undefined, body: string): number {
    if (authorization !== this.opts.authHeader) { this.rejected++; return 403; }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { this.invalid++; return 400; }
    if (!Array.isArray(parsed)) { this.invalid++; return 400; }
    for (const item of parsed as HeliusRawTx[]) {
      try {
        if (!item?.transaction?.signatures?.[0] || !item.meta) throw new Error("not a raw transaction");
        this.queue.push(fromHeliusRaw(item));
        this.received++;
      } catch (e) {
        this.invalid++;
        this.opts.log?.("webhook element ignored", { error: (e as Error).message });
      }
    }
    void this.drain();
    return 200;
  }

  /** Processes the queue; concurrent callers share the in-flight drain so `await drain()` always means "caught up". */
  drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      try {
        while (this.queue.length) {
          const tx = this.queue.shift()!;
          try { if (await this.sink.handle(tx)) this.handled++; } catch (e) { this.opts.log?.("webhook tx failed", { signature: tx.signature, error: (e as Error).message }); }
        }
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }
}

export function startWebhookServer(port: number, queue: WebhookQueue, path = "/webhooks/helius", maxBodyBytes = 10 * 1024 * 1024): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== path) { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > maxBodyBytes) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const status = queue.accept(req.headers["authorization"], Buffer.concat(chunks).toString("utf8"));
      res.writeHead(status); res.end();
    });
  });
  server.listen(port);
  return server;
}

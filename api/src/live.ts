// WS /live (SPEC): trade and new-coin stream for the home page ticker. Fed by Postgres LISTEN on the `satpad_live`
// channel the indexer's processor notifies on, so the API never touches the chain. One pg client holds the LISTEN;
// every socket gets every event; slow sockets are dropped when their buffer exceeds the limit.
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Client } from "pg";

export interface LiveOptions { databaseUrl: string; channel?: string; maxBufferedBytes?: number }

export class LiveHub {
  private client: Client | null = null;
  private readonly sockets = new Set<{ send(data: string): void; readyState: number; bufferedAmount: number; close(): void }>();
  received = 0;
  constructor(private readonly opts: LiveOptions) {}

  async start(): Promise<void> {
    this.client = new Client({ connectionString: this.opts.databaseUrl });
    await this.client.connect();
    this.client.on("notification", (n) => { if (n.payload) this.broadcast(n.payload); });
    this.client.on("error", () => { /* reconnect handled by restart; sockets keep their connection */ });
    await this.client.query(`LISTEN ${this.opts.channel ?? "satpad_live"}`);
  }
  async stop(): Promise<void> { for (const s of this.sockets) s.close(); this.sockets.clear(); await this.client?.end(); this.client = null; }

  attach(socket: { send(data: string): void; readyState: number; bufferedAmount: number; close(): void; on(ev: "close", fn: () => void): void }): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }
  broadcast(payload: string): void {
    this.received++;
    const max = this.opts.maxBufferedBytes ?? 1_000_000;
    for (const s of this.sockets) {
      if (s.readyState !== 1) { this.sockets.delete(s); continue; }
      if (s.bufferedAmount > max) { s.close(); this.sockets.delete(s); continue; }
      s.send(payload);
    }
  }
  get clients(): number { return this.sockets.size; }
}

export async function registerLive(app: FastifyInstance, hub: LiveHub): Promise<void> {
  await app.register(websocket);
  app.get("/live", { websocket: true }, (socket) => {
    hub.attach(socket as never);
    socket.send(JSON.stringify({ kind: "hello", clients: hub.clients }));
  });
}

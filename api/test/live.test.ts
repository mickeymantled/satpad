import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import WebSocket from "ws";
import { DEFAULT_LOCAL_DATABASE_URL, connect, type Db } from "@satpad/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { LiveHub } from "../src/live";
import { FixedPriceProvider } from "../src/prices";

const BASE = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL;
const reachable = async () => { const c = new Client({ connectionString: BASE }); try { await c.connect(); await c.end(); return true; } catch { return false; } };

describe("WS /live (LISTEN/NOTIFY)", async () => {
  if (!(await reachable())) { it.skip("Postgres not reachable", () => {}); return; }
  let db: Db, close: () => Promise<void>, app: FastifyInstance, hub: LiveHub, port: number;
  const channel = `satpad_live_test_${process.pid}`;
  beforeAll(async () => {
    ({ db, close } = connect(BASE));
    hub = new LiveHub({ databaseUrl: BASE, channel });
    await hub.start();
    app = await buildApp({ db, prices: new FixedPriceProvider(1n), live: hub });
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as { port: number }).port;
  });
  afterAll(async () => { await hub.stop(); await app.close(); await close(); });

  it("streams every notification to every connected socket, hello first", async () => {
    const open = (): Promise<{ ws: WebSocket; msgs: string[] }> => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`); const msgs: string[] = [];
      ws.on("message", (d) => msgs.push(d.toString())); ws.on("open", () => resolve({ ws, msgs })); ws.on("error", reject);
    });
    const a = await open(), b = await open();
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.parse(a.msgs[0]!)).toMatchObject({ kind: "hello" });
    const notifier = new Client({ connectionString: BASE }); await notifier.connect();
    await notifier.query(`select pg_notify('${channel}', $1)`, [JSON.stringify({ kind: "trade", mint: "M", side: "buy", btc: "7" })]);
    await notifier.query(`select pg_notify('${channel}', $1)`, [JSON.stringify({ kind: "coin", mint: "N", symbol: "NEW" })]);
    await notifier.end();
    await new Promise((r) => setTimeout(r, 300));
    for (const c of [a, b]) {
      expect(c.msgs.slice(1).map((m) => JSON.parse(m).kind)).toEqual(["trade", "coin"]);
      expect(JSON.parse(c.msgs[1]!).btc).toBe("7");
    }
    expect(hub.clients).toBe(2);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.clients).toBe(1);
    b.ws.close();
  });
});

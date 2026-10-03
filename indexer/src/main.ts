// Indexer entrypoint: polling source over the vault program + every registered coin's bonding curve (+ pool), through
// the rate limiter, into the Processor; optional Helius webhook receiver; /healthz; per-minute RPC-rate log line.
// `--once` runs a single poll pass and exits (CI, smoke checks).
import { createServer } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { coins, connect, keeperHealth } from "@satpad/db";
import { SATPAD_VAULT_PROGRAM_ID } from "@satpad/sdk";
import { loadConfig } from "./config";
import { Processor } from "./process";
import { TokenBucket } from "./ratelimit";
import { PgCursorStore, PollingSource, WebhookQueue, startWebhookServer } from "./sources";

const log = (level: string, msg: string, f: Record<string, unknown> = {}) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, service: "indexer", ...f }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");

async function main(): Promise<void> {
  const cfg = loadConfig();
  const once = process.argv.includes("--once");
  log("info", "starting", { rpc: cfg.rpcUrl.replace(/api-key=[^&]+/i, "api-key=***"), pollIntervalMs: cfg.pollIntervalMs, rpcRatePerSecond: cfg.rpcRatePerSecond, webhook: cfg.webhookPort !== null });
  const conn = new Connection(cfg.rpcUrl, "confirmed");
  const { db, close } = connect(cfg.databaseUrl);
  const bucket = new TokenBucket(cfg.rpcRatePerSecond, cfg.rpcBurst);
  const processor = new Processor(db);
  const polling = new PollingSource(conn, bucket, new PgCursorStore(db), processor, { log: (m, f) => log("warn", m, f) });
  let webhookQueue: WebhookQueue | null = null;
  if (cfg.webhookPort !== null) {
    webhookQueue = new WebhookQueue(processor, { authHeader: cfg.webhookAuthHeader!, log: (m, f) => log("warn", m, f) });
    startWebhookServer(cfg.webhookPort, webhookQueue);
    log("info", "webhook receiver listening", { port: cfg.webhookPort });
  }

  const state = { lastOkAt: null as Date | null, consecutiveFailures: 0, lastError: null as string | null, passes: 0, lastPass: {} as Record<string, unknown> };
  const watchList = async (): Promise<PublicKey[]> => {
    const rows = await db.select({ bondingCurve: coins.bondingCurve, pool: coins.pool }).from(coins);
    const set = new Set<string>([SATPAD_VAULT_PROGRAM_ID.toBase58(), ...cfg.extraAddresses]);
    for (const r of rows) { set.add(r.bondingCurve); if (r.pool) set.add(r.pool); }
    return [...set].map((a) => new PublicKey(a));
  };

  const pass = async () => {
    const t0 = Date.now();
    const before = bucket.stats().total;
    // vault program first: Declared events register coins whose curves are then included in the same pass
    const vault = await polling.pollAll([SATPAD_VAULT_PROGRAM_ID]);
    const others = (await watchList()).filter((a) => !a.equals(SATPAD_VAULT_PROGRAM_ID));
    const rest = await polling.pollAll(others);
    const stats = bucket.stats();
    const result = { addresses: others.length + 1, fetched: vault.fetched + rest.fetched, handled: vault.handled + rest.handled, rpcCalls: stats.total - before, rpcLastMinute: stats.lastMinute, rpcWaitedMs: stats.waitedMs, ms: Date.now() - t0, processor: { ...processor.stats } };
    state.lastPass = result;
    return result;
  };
  const record = async () => {
    await db.insert(keeperHealth).values({ loop: "indexer-poll", instance: cfg.instance, lastOkAt: state.lastOkAt ?? new Date(0), consecutiveFailures: state.consecutiveFailures, lastError: state.lastError })
      .onConflictDoUpdate({ target: [keeperHealth.loop, keeperHealth.instance], set: { lastOkAt: sql`excluded.last_ok_at`, consecutiveFailures: sql`excluded.consecutive_failures`, lastError: sql`excluded.last_error` } });
  };
  const tick = async () => {
    state.passes++;
    try {
      const r = await pass();
      state.lastOkAt = new Date(); state.consecutiveFailures = 0; state.lastError = null;
      log("info", "poll pass", r);
    } catch (e) {
      state.consecutiveFailures++; state.lastError = (e as Error).message;
      log("error", "poll pass failed", { error: state.lastError, consecutiveFailures: state.consecutiveFailures });
    }
    await record();
  };

  if (once) { await tick(); await close(); process.exit(state.consecutiveFailures ? 1 : 0); }

  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/healthz")) { res.writeHead(404); res.end(); return; }
    const stale = state.lastOkAt ? Date.now() - state.lastOkAt.getTime() > cfg.pollIntervalMs * 5 : true;
    const ok = !stale && state.consecutiveFailures < 3;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, instance: cfg.instance, lastOkAt: state.lastOkAt, consecutiveFailures: state.consecutiveFailures, lastError: state.lastError, passes: state.passes, lastPass: state.lastPass, rpc: bucket.stats(), webhook: webhookQueue ? { received: webhookQueue.received, handled: webhookQueue.handled, rejected: webhookQueue.rejected, invalid: webhookQueue.invalid } : null }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }).listen(cfg.healthPort);
  log("info", "running", { healthPort: cfg.healthPort });
  let timer: ReturnType<typeof setTimeout>;
  const loop = async () => { await tick(); timer = setTimeout(() => void loop(), cfg.pollIntervalMs); };
  void loop();
  // one line per minute with the RPC footprint, for the soak summary
  const rateTimer = setInterval(() => log("info", "rpc rate", { ...bucket.stats(), processor: processor.stats }), 60_000);
  const shutdown = async () => { clearTimeout(timer); clearInterval(rateTimer); server.close(); await close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown()); process.on("SIGTERM", () => void shutdown());
}
main().catch((e) => { log("error", "indexer crashed", { error: (e as Error).message }); process.exit(1); });

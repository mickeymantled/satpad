// Keeper entrypoint. Loops: claim-and-settle (M3). Buyback (M6), LP deposit (M6), holder rewards (M7) plug in here.
// `--once` runs every loop a single time and exits non-zero on failure (CI reconciler, smoke checks).
import { Connection } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { connect, keeperHealth } from "@satpad/db";
import { TelegramAlerter, noopAlerter } from "./alerts";
import { RpcChainReader } from "./chain";
import { discoverCoins, upsertCoins } from "./coins";
import { describeConfig, loadConfig } from "./config";
import { FixedFeeProvider, LiveFeeProvider } from "./fees";
import { startHealthServer } from "./health";
import { loadKeypair } from "./keys";
import { PgLedger } from "./ledger";
import { createLogger } from "./log";
import { settleTick } from "./loops/settle";
import { Sender } from "./rpc";
import { Scheduler, type LoopDef } from "./scheduler";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: "keeper", instance: cfg.instance });
  log.info("starting", describeConfig(cfg));
  const keeper = loadKeypair(cfg.keeperKeypairPath);
  const conn = new Connection(cfg.rpcUrl, "confirmed");
  const { db, close } = connect(cfg.databaseUrl);
  const chain = new RpcChainReader(conn);
  const fees = cfg.priorityFeeMode === "live" ? new LiveFeeProvider(conn as never, { min: cfg.priorityFeeMinMicroLamports, max: cfg.priorityFeeMaxMicroLamports, log: (m, f) => log.warn(m, f) }) : new FixedFeeProvider(cfg.fixedPriorityFeeMicroLamports);
  const sender = new Sender(conn, fees, new PgLedger(db), { computeUnitLimit: cfg.computeUnitLimit, maxAttempts: cfg.maxSendAttempts, log });
  const alerter = cfg.telegramBotToken && cfg.telegramChatId ? new TelegramAlerter(cfg.telegramBotToken, cfg.telegramChatId) : noopAlerter;

  const loops: LoopDef[] = [{
    name: "settle", intervalMs: cfg.settleIntervalMs,
    run: async () => {
      const [config, coins, slot] = await Promise.all([chain.vaultConfig(), discoverCoins(conn), chain.slot()]);
      await upsertCoins(db, coins, slot);
      const s = await settleTick({ chain, sender, keeper, dustThreshold: cfg.settleDustThreshold, log }, config, coins);
      if (s.failed > 0) log.warn("tick had failing coins", { failed: s.failed, outcomes: s.outcomes.filter((o) => o.error) });
      return { coins: s.coins, collected: s.collected, settled: s.settled, paid: s.paid, failed: s.failed };
    },
  }];

  const sched = new Scheduler(loops, {
    log, alerter,
    onState: async (s) => {
      await db.insert(keeperHealth).values({ loop: s.name, instance: cfg.instance, lastOkAt: s.lastOkAt ?? new Date(0), consecutiveFailures: s.consecutiveFailures, lastError: s.lastError })
        .onConflictDoUpdate({ target: [keeperHealth.loop, keeperHealth.instance], set: { lastOkAt: sql`excluded.last_ok_at`, consecutiveFailures: sql`excluded.consecutive_failures`, lastError: sql`excluded.last_error` } });
    },
  });

  if (process.argv.includes("--once")) {
    let failed = false;
    for (const l of loops) failed ||= (await sched.tick(l.name)).consecutiveFailures > 0;
    await close();
    process.exit(failed ? 1 : 0);
  }

  const server = startHealthServer(cfg.healthPort, sched, loops, cfg.instance);
  sched.start();
  log.info("running", { loops: loops.map((l) => `${l.name}@${l.intervalMs}ms`), healthPort: cfg.healthPort });
  const shutdown = async (sig: string) => { log.info("shutting down", { sig }); sched.stop(); server.close(); await close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => { console.error(JSON.stringify({ level: "error", msg: "keeper crashed", error: (e as Error).message })); process.exit(1); });

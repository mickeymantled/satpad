// Keeper entrypoint. Loops: claim-and-settle (M3). Buyback (M6), LP deposit (M6), holder rewards (M7) plug in here.
// `--once` runs every loop a single time and exits non-zero on failure (CI reconciler, smoke checks).
import { Connection } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { connect, keeperHealth } from "@satpad/db";
import { TelegramAlerter, noopAlerter } from "./alerts";
import { RpcChainReader } from "./chain";
import { discoverCoins, upsertCoins } from "./coins";
import { describeConfig, loadConfig } from "./config";
import { FixedFeeProvider, LiveFeeProvider } from "@satpad/sdk";
import { startHealthServer } from "./health";
import { loadKeypair } from "./keys";
import { PgLedger } from "./ledger";
import { createLogger } from "./log";
import { settleTick } from "./loops/settle";
import { buybackTick } from "./loops/buyback";
import { ammLiquidityState, ammSwapState, buildAmmCollectCreatorFee } from "@satpad/sdk";
import { lpTick } from "./loops/lp";
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
  const store = new PgLedger(db);
  const sender = new Sender(conn, fees, store, { computeUnitLimit: cfg.computeUnitLimit, maxAttempts: cfg.maxSendAttempts, log });
  const alerter = cfg.telegramBotToken && cfg.telegramChatId ? new TelegramAlerter(cfg.telegramBotToken, cfg.telegramChatId) : noopAlerter;

  const loops: LoopDef[] = [{
    name: "settle", intervalMs: cfg.settleIntervalMs,
    run: async () => {
      const [config, coins, slot] = await Promise.all([chain.vaultConfig(), discoverCoins(conn), chain.slot()]);
      await upsertCoins(db, coins, slot);
      const s = await settleTick({ chain, sender, keeper, dustThreshold: cfg.settleDustThreshold, log, ammCollect: (coinCreator) => buildAmmCollectCreatorFee(conn, coinCreator, keeper.publicKey) }, config, coins);
      if (s.failed > 0) log.warn("tick had failing coins", { failed: s.failed, outcomes: s.outcomes.filter((o) => o.error) });
      return { coins: s.coins, collected: s.collected, settled: s.settled, paid: s.paid, failed: s.failed };
    },
  }];
  if (cfg.buybackWalletKeypairPath) {
    const buybackWallet = loadKeypair(cfg.buybackWalletKeypairPath);
    loops.push({
      name: "buyback", intervalMs: cfg.buybackIntervalMs,
      run: async () => {
        const r = await buybackTick({ chain, sender, buybackWallet, minSats: cfg.buybackMinSats, slippagePct: cfg.buybackSlippagePct, swapState: (pool, user) => ammSwapState(conn, pool, user), log, inflowLastHour: () => store.buybackInflow(1), alerter }, await chain.vaultConfig());
        return { ...(r.skipped && { skipped: r.skipped }), ...(r.sats !== undefined && { sats: r.sats.toString(), tokens: r.tokens?.toString(), signature: r.signature }) };
      },
    });
  } else log.warn("BUYBACK_WALLET_KEYPAIR not set; buyback loop disabled");
  if (cfg.lpWalletKeypairPath) {
    const lpWallet = loadKeypair(cfg.lpWalletKeypairPath);
    const table = cfg.reserveAlt ? (await conn.getAddressLookupTable(cfg.reserveAlt)).value : null;
    if (cfg.reserveAlt && !table) throw new Error(`RESERVE_ALT ${cfg.reserveAlt.toBase58()} not found`);
    if (!table) log.warn("RESERVE_ALT not set; the LP run will only fit if the four instructions stay under 1232 bytes");
    loops.push({
      name: "lp", intervalMs: cfg.lpIntervalMs,
      run: async () => {
        const r = await lpTick({ chain, sender, lpWallet, minDrawSats: cfg.lpMinDrawSats, slippagePct: cfg.lpSlippagePct, swapState: (p, u) => ammSwapState(conn, p, u), liquidityState: (p, u) => ammLiquidityState(conn, p, u), tables: table ? [table] : [], alerter, log }, await chain.vaultConfig());
        return { ...(r.skipped && { skipped: r.skipped }), ...(r.plan && { drawn: r.plan.draw.toString(), swapped: r.plan.maxQuoteIn.toString(), lpBurned: r.plan.lpTokens.toString(), signature: r.signature, lpSupply: `${r.lpSupplyBefore}→${r.lpSupplyAfter}` }) };
      },
    });
  } else log.warn("LP_WALLET_KEYPAIR not set; LP deposit loop disabled");

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

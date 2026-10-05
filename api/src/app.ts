// Fastify app (DECISIONS D16). Read-only over the indexer tables; every amount is {base, ui[, usd]}; rate limited.
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { LiveFeeProvider, configPda, decodeConfig } from "@satpad/sdk";
import { Connection } from "@solana/web3.js";
import type { Db } from "@satpad/db";
import { btc, iso, tokens } from "./format";
import type { PriceProvider } from "./prices";
import { registerLive, type LiveHub } from "./live";
import { registerDevFaucet } from "./devFaucet";
import { registerJupiter, type JupiterOptions } from "./jupiter";
import { registerMetadata, type MetadataBackend } from "./metadata";
import { COIN_SORTS, coinHolders, coinRewards, coinTrades, getCoin, ledgerFeed, listCoins, reserveRuns, stats, type CoinSort, type Stage } from "./queries";

export interface AppDeps { db: Db; prices: PriceProvider; rpc?: Connection; rateLimitPerMinute?: number; live?: LiveHub; /** Browser origins allowed to call the API (SPEC: CSP/no third-party); "*" only for local dev. */ corsOrigins?: string[]; /** D17: path to the fork wBTC authority keypair; never set outside the fork. */ devFaucetKeypair?: string; /** V10: Jupiter proxy; `null` disables it (e.g. a fork with the dev faucet). */ jupiter?: JupiterOptions | null; /** D18: active metadata backend + public origins for `/m/:id` URIs and the website back-link. */ metadata?: { backend: MetadataBackend; publicUrl: string; webUrl: string; pumpUrl?: string; fetchImpl?: typeof fetch }; /** D14: launch lookup table address served to the web app. */ launchAlt?: string }
const page = (q: Record<string, unknown>) => ({ limit: Math.min(100, Math.max(1, Number(q["limit"] ?? 25) || 25)), offset: Math.max(0, Number(q["offset"] ?? 0) || 0) });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: deps.rateLimitPerMinute ?? 120, timeWindow: "1 minute" });
  // CORS for the web app (read-only GETs + the dev faucet POST). Origin allowlist; no credentials.
  const origins = deps.corsOrigins ?? ["*"];
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && (origins.includes("*") || origins.includes(origin))) {
      reply.header("access-control-allow-origin", origins.includes("*") ? "*" : origin);
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
      reply.header("access-control-max-age", "600");
      if (!origins.includes("*")) reply.header("vary", "origin");
    }
    if (req.method === "OPTIONS") return reply.code(204).send();
  });
  app.addHook("onSend", async (_req, reply) => { if (!reply.hasHeader("cache-control")) reply.header("cache-control", "public, max-age=2"); });

  if (deps.live) await registerLive(app, deps.live);
  if (deps.devFaucetKeypair && deps.rpc) registerDevFaucet(app, deps.rpc, deps.devFaucetKeypair);
  if (deps.jupiter !== null) registerJupiter(app, deps.jupiter ?? {});
  const metadata = deps.metadata ?? { backend: "api" as const, publicUrl: "http://127.0.0.1:8083", webUrl: "http://127.0.0.1:3000" };
  registerMetadata(app, { db: deps.db, ...metadata });
  app.get("/healthz", async () => ({ ok: true, liveClients: deps.live?.clients ?? 0 }));
  /** D18: runtime config the web app reads (active metadata backend, dev faucet presence). */
  app.get("/config", async () => ({ metadataBackend: metadata.backend, launchAlt: deps.launchAlt ?? null, webUrl: metadata.webUrl, devFaucet: Boolean(deps.devFaucetKeypair), swap: deps.devFaucetKeypair ? "dev-faucet" : deps.jupiter !== null ? "jupiter" : "none", cluster: process.env["CLUSTER"] ?? "custom" }));

  app.get("/coins", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const sort = (q["sort"] ?? "volume24h") as CoinSort;
    if (!COIN_SORTS.includes(sort)) return reply.code(400).send({ error: `sort must be one of ${COIN_SORTS.join("|")}` });
    const stage = q["stage"] as Stage | undefined;
    if (stage && !["dust", "mining", "block"].includes(stage)) return reply.code(400).send({ error: "stage must be dust|mining|block" });
    const { limit, offset } = page(q);
    const [{ rows, total }, price] = await Promise.all([listCoins(deps.db, { sort, ...(stage && { stage }), paysHolders: q["pays_holders"] === "true", limit, offset }), deps.prices.btcUsd()]);
    return { total, limit, offset, btcUsd: price.usdCents.toString(), coins: rows.map((r) => coinSummary(r, price.usdCents)) };
  });

  app.get("/coins/:mint", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const [row, price] = await Promise.all([getCoin(deps.db, mint), deps.prices.btcUsd()]);
    if (!row) return reply.code(404).send({ error: "unknown coin" });
    const c = row.c;
    return {
      ...coinSummary(row, price.usdCents),
      uri: c.uri, deployer: c.deployer, bondingCurve: c.bondingCurve, pool: c.pool, poolReserves: c.poolBaseReserves !== null && c.poolQuoteReserves !== null ? { base: c.poolBaseReserves, quote: c.poolQuoteReserves } : null, paused: c.paused, treasuryOnly: c.treasuryOnly, graduatedAt: iso(c.graduatedAt), indexedSlot: c.indexedSlot.toString(),
      fees: { settles: row.feeTotals.settles, creatorFee: btc(row.feeTotals.fee, price.usdCents), liquidity: btc(row.feeTotals.liquidity, price.usdCents), deployer: btc(row.feeTotals.deployer, price.usdCents) },
      accounts: await feeAccounts(mint),
    };
  });

  app.get("/coins/:mint/trades", async (req) => {
    const { mint } = req.params as { mint: string }; const { limit, offset } = page(req.query as Record<string, unknown>);
    const rows = await coinTrades(deps.db, mint, limit, offset);
    return { limit, offset, trades: rows.map((t) => ({ signature: t.signature, side: t.side, btc: btc(t.btcAmount), tokens: tokens(t.tokenAmount), priceBtcScaled: t.priceBtcScaled, trader: t.trader, slot: t.slot.toString(), time: iso(t.blockTime), venue: t.venue, creatorFee: t.creatorFeeBtc ? btc(t.creatorFeeBtc) : null })) };
  });
  app.get("/coins/:mint/holders", async (req) => {
    const { mint } = req.params as { mint: string }; const { limit, offset } = page(req.query as Record<string, unknown>);
    const rows = await coinHolders(deps.db, mint, limit, offset);
    return { limit, offset, holders: rows.map((h) => ({ wallet: h.wallet, balance: tokens(h.balance), updatedSlot: h.updatedSlot.toString() })) };
  });
  app.get("/coins/:mint/rewards", async (req) => {
    const { mint } = req.params as { mint: string }; const { limit, offset } = page(req.query as Record<string, unknown>);
    const rows = await coinRewards(deps.db, mint, limit, offset);
    return { limit, offset, runs: rows.map((r) => ({ runIndex: r.runIndex.toString(), snapshotHash: r.snapshotHash, snapshotUrl: r.snapshotUrl, pot: btc(r.potBtc), holdersPaid: r.holdersPaid, skipped: r.skipped, transferSignatures: r.transferSignatures, releaseSignature: r.releaseSignature, slot: r.slot.toString(), time: iso(r.releasedAt) })) };
  });

  app.get("/ledger", async (req) => {
    const q = req.query as Record<string, string | undefined>; const { limit, offset } = page(q);
    const rows = await ledgerFeed(deps.db, q["type"], limit, offset);
    return { limit, offset, entries: rows.map((r) => ({ id: r.id.toString(), signature: r.signature, type: r.type, mint: r.mint, actor: r.actor, amounts: Object.fromEntries(Object.entries(r.amounts).map(([k, v]) => [k, /^\d+$/.test(v) ? btc(v) : v])) /* non-numeric values such as collect `venue` pass through */, status: r.status, error: r.error, attempts: r.attempts, slot: r.slot?.toString() ?? null, createdAt: iso(r.createdAt), confirmedAt: iso(r.confirmedAt) })) };
  });

  /** Priority fee for user transactions (micro-lamports per CU): Helius when the API's RPC is Helius, else recent fees, else min. */
  const feeMin = 1_000n, feeMax = 2_000_000n;
  app.get("/fees/priority", async () => {
    if (!deps.rpc) return { microLamportsPerCu: feeMin.toString(), source: "default", min: feeMin.toString(), max: feeMax.toString() };
    const provider = new LiveFeeProvider(deps.rpc as never, { min: feeMin, max: feeMax });
    const { Transaction, SystemProgram, Keypair } = await import("@solana/web3.js");
    const k = Keypair.generate().publicKey;
    const probe = new Transaction().add(SystemProgram.transfer({ fromPubkey: k, toPubkey: k, lamports: 0 }));
    probe.feePayer = k; probe.recentBlockhash = k.toBase58();
    const fee = await provider.estimate(probe, 1);
    return { microLamportsPerCu: fee.toString(), source: "live", min: feeMin.toString(), max: feeMax.toString() };
  });

  // M6: the Reserve's LP runs (draw → swap → deposit → burn), newest first, with totals.
  app.get("/reserve", async (req) => {
    const { limit, offset } = page(req.query as Record<string, unknown>);
    const r = await reserveRuns(deps.db, limit, offset);
    return { limit, offset, totals: { runs: r.totals.runs, btcDrawn: btc(r.totals.drawn), lpMinted: r.totals.minted, lpBurned: r.totals.burned, netLpSupplyChange: (BigInt(r.totals.minted) - BigInt(r.totals.burned)).toString() },
      runs: r.runs.map((x) => ({ signature: x.signature, btcDrawn: btc(x.btcDrawn), satpadBought: tokens(x.satpadBought), lpMinted: x.lpMinted, lpBurned: x.lpBurned, poolReservesAfter: x.poolReservesAfter, slot: x.slot.toString(), time: iso(x.ranAt) })) };
  });

  app.get("/stats", async () => {
    const [s, price] = await Promise.all([stats(deps.db), deps.prices.btcUsd()]);
    const u = price.usdCents;
    return { coinsLaunched: s.coins, btcIntoLiquidity: btc(s.btcIntoLiquidity, u), btcToBuyback: btc(s.btcToBuyback, u), creatorFees: btc(s.creatorFees, u), satpadBurned: tokens(s.satpadBurned), btcPaidToHolders: btc(s.btcPaidToHolders, u), btcTradedToday: btc(s.btcTradedToday, u), tradesToday: s.tradesToday, btcUsd: { cents: u.toString(), publishTime: price.publishTime, source: price.source } };
  });

  async function feeAccounts(mint: string) {
    const { coinFeePda, coinFeeAta, payeePotPda, rewardsPotPda, lpPotPda } = await import("@satpad/sdk");
    const { PublicKey } = await import("@solana/web3.js");
    const m = new PublicKey(mint);
    return { coinFee: coinFeePda(m)[0].toBase58(), coinFeeAta: coinFeeAta(m).toBase58(), payeePot: payeePotPda(m)[0].toBase58(), rewardsPot: rewardsPotPda(m)[0].toBase58(), lpPot: lpPotPda()[0].toBase58(), config: configPda()[0].toBase58() };
  }
  void decodeConfig;
  return app;
}

type CoinRow = Awaited<ReturnType<typeof listCoins>>["rows"][number];
function coinSummary(r: CoinRow, usdCents: bigint) {
  const c = r.c;
  return {
    mint: c.mint, name: c.name, symbol: c.symbol, stage: c.stage, payeeMode: c.payeeMode, payee: c.payee, paysHolders: c.payeeMode === "holders",
    curveProgressBps: r.progressBps, buys: c.buys, sells: c.sells, holderCount: c.holderCount,
    mcap: btc(r.mcapSats, usdCents), volume24h: btc(r.volume24, usdCents), trades24h: r.trades24, volumeLifetime: btc(c.volumeBtc, usdCents), btcPaidToHolders: btc(c.btcPaidToHolders, usdCents),
    createdAt: iso(c.createdAt), lastTradeAt: iso(c.lastTradeAt),
  };
}

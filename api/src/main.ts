import { connect } from "@satpad/db";
import { buildApp } from "./app";
import { Connection } from "@solana/web3.js";
import { CachedPriceProvider, FixedPriceProvider, PythPriceProvider } from "./prices";
import { LiveHub } from "./live";

async function main() {
  const port = Number(process.env["API_PORT"] ?? 8083);
  const { db } = connect(process.env["DATABASE_URL"]);
  const live = new LiveHub({ databaseUrl: process.env["DATABASE_URL"] ?? "" });
  await live.start();
  // PRICE_SOURCE=pyth reads the on-chain feed (V7); anything else is a fixed dev price for the fork.
  const fixedCents = BigInt(process.env["BTC_USD_CENTS"] ?? "10000000"); // $100,000.00 default on the fork
  const inner = process.env["PRICE_SOURCE"] === "pyth" ? new PythPriceProvider(new Connection(process.env["SOLANA_RPC_URL"] ?? "", "confirmed")) : new FixedPriceProvider(fixedCents);
  const prices = new CachedPriceProvider(inner, Number(process.env["PRICE_CACHE_MS"] ?? 30_000));
  const corsOrigins = (process.env["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const rpc = new Connection(process.env["SOLANA_RPC_URL"] ?? "http://127.0.0.1:8899", "confirmed");
  const app = await buildApp({ db, prices, rpc, rateLimitPerMinute: Number(process.env["RATE_LIMIT_PER_MINUTE"] ?? 120), live, corsOrigins, ...(process.env["DEV_FAUCET_KEYPAIR"] && { devFaucetKeypair: process.env["DEV_FAUCET_KEYPAIR"] }), jupiter: process.env["JUPITER_API_URL"] === "off" ? null : { ...(process.env["JUPITER_API_URL"] && { baseUrl: process.env["JUPITER_API_URL"] }), ...(process.env["JUPITER_API_KEY"] && { apiKey: process.env["JUPITER_API_KEY"] }) } });
  await app.listen({ port, host: "0.0.0.0" });
  process.stdout.write(JSON.stringify({ level: "info", msg: "api listening", port }) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });

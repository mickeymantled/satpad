// Indexer configuration from env. Defaults suit the local fork; production sets the Helius URL and webhook secret.
export interface IndexerConfig {
  rpcUrl: string; databaseUrl: string; instance: string;
  pollIntervalMs: number;
  /** RPC calls per second the polling source may make (human note, M4 task 5: never skew the soak). */
  rpcRatePerSecond: number;
  rpcBurst: number;
  webhookPort: number | null; webhookAuthHeader: string | null;
  healthPort: number;
  /** Extra static addresses to watch (e.g. the $SATPAD pool once it exists). */
  extraAddresses: string[];
}
const int = (env: NodeJS.ProcessEnv, k: string, d: number) => { const v = env[k]; if (v === undefined || v === "") return d; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`env ${k} must be a non-negative number`); return n; };
const req = (env: NodeJS.ProcessEnv, k: string) => { const v = env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const webhookPort = env["WEBHOOK_PORT"] ? int(env, "WEBHOOK_PORT", 0) : null;
  if (webhookPort && !env["WEBHOOK_AUTH_HEADER"]) throw new Error("WEBHOOK_AUTH_HEADER required when WEBHOOK_PORT is set");
  return {
    rpcUrl: req(env, "SOLANA_RPC_URL"), databaseUrl: req(env, "DATABASE_URL"), instance: env["INDEXER_INSTANCE"] ?? "indexer-1",
    pollIntervalMs: int(env, "POLL_INTERVAL_MS", 5_000), rpcRatePerSecond: int(env, "RPC_RATE_PER_SECOND", 4), rpcBurst: int(env, "RPC_BURST", 8),
    webhookPort, webhookAuthHeader: env["WEBHOOK_AUTH_HEADER"] ?? null, healthPort: int(env, "HEALTH_PORT", 8082),
    extraAddresses: (env["EXTRA_ADDRESSES"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

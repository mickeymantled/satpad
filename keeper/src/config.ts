// Keeper configuration from env (SPEC "Keeper service → Rules": config via env, no secrets in the repo). Parsed once,
// validated loudly; amounts are bigint base units.
import { PublicKey } from "@solana/web3.js";

export interface KeeperConfig {
  rpcUrl: string;
  databaseUrl: string;
  instance: string;
  keeperKeypairPath: string;
  lpWalletKeypairPath?: string;
  rewardsWalletKeypairPath?: string;
  /** Skip claim+settle when a coin's unclaimed creator fee is below this (base units). */
  settleDustThreshold: bigint;
  /** Loop intervals, ms. */
  settleIntervalMs: number;
  /** Priority fee: "helius" uses the RPC's getPriorityFeeEstimate; "fixed" uses fixedPriorityFeeMicroLamports. */
  priorityFeeMode: "helius" | "fixed";
  fixedPriorityFeeMicroLamports: bigint;
  computeUnitLimit: number;
  maxSendAttempts: number;
  healthPort: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  programId?: PublicKey;
}

const req = (env: NodeJS.ProcessEnv, k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const int = (env: NodeJS.ProcessEnv, k: string, d: number): number => {
  const v = env[k];
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`env ${k} must be a non-negative integer, got ${JSON.stringify(v)}`);
  return n;
};
const big = (env: NodeJS.ProcessEnv, k: string, d: bigint): bigint => {
  const v = env[k];
  if (v === undefined || v === "") return d;
  if (!/^\d+$/.test(v)) throw new Error(`env ${k} must be a base-unit integer, got ${JSON.stringify(v)}`);
  return BigInt(v);
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const mode = env["PRIORITY_FEE_MODE"] ?? "fixed";
  if (mode !== "helius" && mode !== "fixed") throw new Error(`PRIORITY_FEE_MODE must be helius|fixed, got ${mode}`);
  const attempts = int(env, "MAX_SEND_ATTEMPTS", 5);
  if (attempts < 1 || attempts > 5) throw new Error("MAX_SEND_ATTEMPTS must be 1..5 (SPEC: max 5 attempts)");
  const cfg: KeeperConfig = {
    rpcUrl: req(env, "SOLANA_RPC_URL"),
    databaseUrl: req(env, "DATABASE_URL"),
    instance: env["KEEPER_INSTANCE"] ?? "keeper-1",
    keeperKeypairPath: req(env, "KEEPER_KEYPAIR"),
    settleDustThreshold: big(env, "SETTLE_DUST_THRESHOLD", 1_000n),
    settleIntervalMs: int(env, "SETTLE_INTERVAL_MS", 60_000),
    priorityFeeMode: mode,
    fixedPriorityFeeMicroLamports: big(env, "FIXED_PRIORITY_FEE_MICRO_LAMPORTS", 1_000n),
    computeUnitLimit: int(env, "COMPUTE_UNIT_LIMIT", 400_000),
    maxSendAttempts: attempts,
    healthPort: int(env, "HEALTH_PORT", 8080),
  };
  if (env["LP_WALLET_KEYPAIR"]) cfg.lpWalletKeypairPath = env["LP_WALLET_KEYPAIR"];
  if (env["REWARDS_WALLET_KEYPAIR"]) cfg.rewardsWalletKeypairPath = env["REWARDS_WALLET_KEYPAIR"];
  if (env["TELEGRAM_BOT_TOKEN"]) cfg.telegramBotToken = env["TELEGRAM_BOT_TOKEN"];
  if (env["TELEGRAM_CHAT_ID"]) cfg.telegramChatId = env["TELEGRAM_CHAT_ID"];
  if (env["SATPAD_VAULT_PROGRAM_ID"]) cfg.programId = new PublicKey(env["SATPAD_VAULT_PROGRAM_ID"]);
  return cfg;
}

/** Safe-to-log view: paths and URLs without credentials. */
export function describeConfig(c: KeeperConfig): Record<string, unknown> {
  return { rpc: c.rpcUrl.replace(/api-key=[^&]+/i, "api-key=***"), db: c.databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"), instance: c.instance, priorityFeeMode: c.priorityFeeMode, settleDustThreshold: c.settleDustThreshold, settleIntervalMs: c.settleIntervalMs, maxSendAttempts: c.maxSendAttempts };
}

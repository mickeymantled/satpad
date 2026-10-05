// Serializes a graduated coin's PumpSwap swap + liquidity state from the fork into packages/sdk/test/fixtures/amm_state.json
// (BN → {$bn}, PublicKey → {$pk}, bigint → {$big}, Buffer → {$b64}) so SDK unit tests run the wrappers offline.
// Usage: LOCAL_RPC_URL=http://127.0.0.1:8999 FORK_KEYS_DIR=scripts/fork-keys-m6 npx tsx scripts/capture-amm-state.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { ammLiquidityState, ammSwapState, poolForMint } from "@satpad/sdk";
import { KEYS_DIR, RPC } from "./lib/fork";

export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return { $big: v.toString() };
  if (BN.isBN(v)) return { $bn: (v as BN).toString() };
  if (v instanceof PublicKey) return { $pk: v.toBase58() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $b64: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seed = JSON.parse(readFileSync(`${KEYS_DIR}/seed.json`, "utf8")) as { wallets: Record<string, { pubkey: string }>; coins: { mint: string }[] };
  const mint = new PublicKey(seed.coins[0]!.mint), user = new PublicKey(seed.wallets["deployer"]!.pubkey);
  const pool = poolForMint(mint);
  const [swap, liquidity] = await Promise.all([ammSwapState(conn, pool, user), ammLiquidityState(conn, pool, user)]);
  mkdirSync("packages/sdk/test/fixtures", { recursive: true });
  writeFileSync("packages/sdk/test/fixtures/amm_state.json", JSON.stringify({ capturedAt: new Date().toISOString(), mint: mint.toBase58(), user: user.toBase58(), pool: pool.toBase58(), swap: plain(swap), liquidity: plain(liquidity) }, null, 2));
  console.log(JSON.stringify({ pool: pool.toBase58(), base: swap.poolBaseAmount.toString(), quote: swap.poolQuoteAmount.toString(), lpSupplyField: swap.pool.lpSupply.toString(), creatorFeeBps: String(swap.pool.creatorFeeBps) }));
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

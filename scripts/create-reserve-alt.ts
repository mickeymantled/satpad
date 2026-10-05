// One-time per deployment (D14 pattern, M6): lookup table of every account shared by all LP runs — draw_lp + PumpSwap buy
// + deposit on the $SATPAD pool + LP burn — so the keeper's single-transaction LP run fits 1232 bytes. Prints the
// address for RESERVE_ALT. Requires Config.satpad_pool (bootstrap first). --dry-run prints the addresses only.
// Env: SOLANA_RPC_URL (or LOCAL_RPC_URL via lib/fork), RESERVE_ALT_AUTHORITY_KEYPAIR (payer/authority).
import { Keypair, PublicKey } from "@solana/web3.js";
import { createBurnInstruction } from "@solana/spl-token";
import { LP_TOKEN_PROGRAM, ammLiquidityState, ammSwapState, buildAmmBuy, buildAmmDeposit, buildDrawLp, createLookupTable, lpMintOf, staticAccounts } from "@satpad/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DRY_RUN, connection, fetchConfig, keypairFromEnv } from "./lib/cli";

async function main() {
  const conn = connection();
  const config = await fetchConfig(conn);
  if (!config || config.satpadPool.equals(PublicKey.default)) throw new Error("Config.satpad_pool not set — run bootstrap-satpad first");
  const probe = async () => {
    const u = Keypair.generate().publicKey;
    const [swap, liq] = await Promise.all([ammSwapState(conn, config.satpadPool, u), ammLiquidityState(conn, config.satpadPool, u)]);
    const lpMint = lpMintOf(liq.pool);
    return [await buildDrawLp({ lpWallet: u, amount: 1n }), ...(await buildAmmBuy(swap, 1n, 1n)), ...(await buildAmmDeposit(liq, 1n, 1n, 1n)), createBurnInstruction(getAssociatedTokenAddressSync(lpMint, u, true, LP_TOKEN_PROGRAM), lpMint, u, 1n, [], LP_TOKEN_PROGRAM)];
  };
  const addresses = staticAccounts(await probe(), await probe());
  console.log(JSON.stringify({ rpc: conn.rpcEndpoint, pool: config.satpadPool.toBase58(), addresses: addresses.map((a) => a.toBase58()) }, null, 2));
  if (DRY_RUN) { console.log("(dry-run) no table created"); return; }
  const payer = keypairFromEnv("RESERVE_ALT_AUTHORITY_KEYPAIR");
  const table = await createLookupTable(conn, payer, addresses);
  console.log(JSON.stringify({ reserveAlt: table.key.toBase58(), entries: table.state.addresses.length }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

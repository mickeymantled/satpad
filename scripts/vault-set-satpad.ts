// Admin: record the $SATPAD mint, PumpSwap pool and LP mint in Config, once (DECISIONS D21). Refuses if already set.
// Usage: pnpm vault:set-satpad --mint <pk> --pool <pk> --lp-mint <pk> [--dry-run]
import { buildSetSatpad } from "@satpad/sdk";
import { PublicKey } from "@solana/web3.js";
import { connection, fetchConfig, keypairFromEnv, main, pubkeyArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const admin = keypairFromEnv("ADMIN_KEYPAIR");
  const satpadMint = pubkeyArg("mint"), satpadPool = pubkeyArg("pool"), satpadLpMint = pubkeyArg("lp-mint");
  if (!satpadMint || !satpadPool || !satpadLpMint) throw new Error("--mint, --pool and --lp-mint are required");
  const before = await fetchConfig(conn);
  if (!before) throw new Error("Config not found");
  const cur = { satpadMint: before.satpadMint.toBase58(), satpadPool: before.satpadPool.toBase58(), satpadLpMint: before.satpadLpMint.toBase58() };
  console.log("current:", cur);
  if (!before.satpadMint.equals(PublicKey.default) || !before.satpadPool.equals(PublicKey.default) || !before.satpadLpMint.equals(PublicKey.default)) throw new Error("already set — write-once; changing requires a program upgrade (D21)");
  console.log("setting:", { satpadMint: satpadMint.toBase58(), satpadPool: satpadPool.toBase58(), satpadLpMint: satpadLpMint.toBase58() });
  await run(conn, "set_satpad", [await buildSetSatpad(admin.publicKey, { satpadMint, satpadPool, satpadLpMint })], [admin]);
});

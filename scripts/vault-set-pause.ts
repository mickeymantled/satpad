// Admin: pause or unpause settle globally or for one coin.
// Usage: pnpm vault:set-pause --paused true|false [--mint <pk>] [--dry-run]
import { PublicKey } from "@solana/web3.js";
import { buildSetCoinPause, buildSetPause } from "@satpad/sdk";
import { arg, connection, keypairFromEnv, main, requireArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const admin = keypairFromEnv("ADMIN_KEYPAIR");
  const paused = requireArg("paused") === "true";
  const mint = arg("mint");
  const ix = mint ? await buildSetCoinPause(admin.publicKey, new PublicKey(mint), paused) : await buildSetPause(admin.publicKey, paused);
  await run(conn, mint ? `set_coin_pause(${mint}, ${paused})` : `set_pause(${paused})`, [ix], [admin]);
});

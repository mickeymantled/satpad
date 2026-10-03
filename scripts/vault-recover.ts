// Admin: move a PAUSED coin's CoinFee balance to the program's fixed RECOVERY_ADDRESS. The recovery ATA must exist.
// Usage: SATPAD_RECOVERY_ADDRESS=<pk> pnpm vault:recover --mint <pk> [--dry-run]
import { PublicKey } from "@solana/web3.js";
import { buildRecover } from "@satpad/sdk";
import { connection, keypairFromEnv, main, requireArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const admin = keypairFromEnv("ADMIN_KEYPAIR");
  const recovery = process.env["SATPAD_RECOVERY_ADDRESS"];
  if (!recovery) throw new Error("SATPAD_RECOVERY_ADDRESS not set (must equal the program's compiled RECOVERY_ADDRESS)");
  const mint = new PublicKey(requireArg("mint"));
  await run(conn, `recover(${mint.toBase58()})`, [await buildRecover({ admin: admin.publicKey, mint, recoveryAddress: new PublicKey(recovery) })], [admin]);
});

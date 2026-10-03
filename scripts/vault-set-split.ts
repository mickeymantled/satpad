// Admin: change the fee split within program bounds. Applies to every later settle.
// Usage: pnpm vault:set-split --liquidity 2500 --buyback 2500 --operator 1000 --deployer 4000 [--dry-run]
import { assertValidSplit, buildSetSplit } from "@satpad/sdk";
import { connection, fetchConfig, keypairFromEnv, main, requireArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const admin = keypairFromEnv("ADMIN_KEYPAIR");
  const split = { liquidityBps: Number(requireArg("liquidity")), buybackBps: Number(requireArg("buyback")), operatorBps: Number(requireArg("operator")), deployerBps: Number(requireArg("deployer")) };
  assertValidSplit(split);
  const before = await fetchConfig(conn);
  console.log("current split:", before?.split, "→", split);
  await run(conn, "set_split", [await buildSetSplit(admin.publicKey, split)], [admin]);
});

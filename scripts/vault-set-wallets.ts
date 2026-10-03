// Admin: change treasury / buyback / rewards wallets (any subset). Never the recovery address or LP wallet.
// Usage: pnpm vault:set-wallets [--treasury <pk>] [--buyback <pk>] [--rewards <pk>] [--dry-run]
import { buildSetWallets } from "@satpad/sdk";
import { connection, fetchConfig, keypairFromEnv, main, pubkeyArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const admin = keypairFromEnv("ADMIN_KEYPAIR");
  const w = { treasury: pubkeyArg("treasury"), buybackWallet: pubkeyArg("buyback"), rewardsWallet: pubkeyArg("rewards") };
  if (!w.treasury && !w.buybackWallet && !w.rewardsWallet) throw new Error("nothing to change");
  const before = await fetchConfig(conn);
  console.log("current:", { treasury: before?.treasury.toBase58(), buyback: before?.buybackWallet.toBase58(), rewards: before?.rewardsWallet.toBase58() });
  console.log("changing:", Object.fromEntries(Object.entries(w).filter(([, v]) => v).map(([k, v]) => [k, v!.toBase58()])));
  await run(conn, "set_wallets", [await buildSetWallets(admin.publicKey, { ...(w.treasury && { treasury: w.treasury }), ...(w.buybackWallet && { buybackWallet: w.buybackWallet }), ...(w.rewardsWallet && { rewardsWallet: w.rewardsWallet }) })], [admin]);
});

// One-time: create Config + LpPot. Signer = deployer (DEPLOYER_KEYPAIR). SPEC "Mainnet rollout" step 2.
// Usage: pnpm vault:initialize --admin <pk> --treasury <pk> --buyback <pk> --rewards <pk> --lp <pk> [--creator-fee-bps 100]
//        [--lp-draw-max 500000] [--lp-draw-interval 300] [--launch-fee-lamports 10000000] [--quote-mint <pk>] [--dry-run]
import { DEFAULT_CREATOR_FEE_BPS, DEFAULT_SPLIT, buildInitialize } from "@satpad/sdk";
import { DRY_RUN, bigintArg, connection, fetchConfig, keypairFromEnv, main, pubkeyArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  if (await fetchConfig(conn)) throw new Error("Config already initialized");
  const payer = keypairFromEnv("DEPLOYER_KEYPAIR");
  const req = (n: string) => { const v = pubkeyArg(n); if (!v) throw new Error(`missing --${n}`); return v; };
  const ix = await buildInitialize({
    payer: payer.publicKey, admin: req("admin"), treasury: req("treasury"), buybackWallet: req("buyback"), rewardsWallet: req("rewards"), lpWallet: req("lp"),
    split: DEFAULT_SPLIT, lpDrawMax: bigintArg("lp-draw-max") ?? 500_000n, lpDrawIntervalSecs: bigintArg("lp-draw-interval") ?? 300n,
    creatorFeeBps: Number(bigintArg("creator-fee-bps") ?? BigInt(DEFAULT_CREATOR_FEE_BPS)), launchFeeLamports: bigintArg("launch-fee-lamports") ?? 10_000_000n,
    ...(pubkeyArg("quote-mint") ? { quoteMint: pubkeyArg("quote-mint")! } : {}),
  });
  await run(conn, "initialize", [ix], [payer]);
  if (!DRY_RUN) console.log(JSON.stringify(await fetchConfig(conn), (_k, v) => (typeof v === "bigint" ? v.toString() : v?.toBase58?.() ?? v), 2));
});

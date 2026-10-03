// Upgrade authority (Squads vault on mainnet): set LP wallet and draw limits within program caps.
// On mainnet this script only produces the instruction for a Squads proposal; direct signing is for the local fork.
// Usage: pnpm vault:set-lp [--lp-wallet <pk>] [--lp-draw-max <sats>] [--lp-draw-interval <secs>] [--dry-run] [--print-ix]
import { buildSetLp } from "@satpad/sdk";
import { bigintArg, connection, keypairFromEnv, main, pubkeyArg, run } from "./lib/cli";

main(async () => {
  const conn = connection();
  const lpWallet = pubkeyArg("lp-wallet"), lpDrawMax = bigintArg("lp-draw-max"), lpDrawIntervalSecs = bigintArg("lp-draw-interval");
  if (!lpWallet && lpDrawMax === undefined && lpDrawIntervalSecs === undefined) throw new Error("nothing to change");
  const authority = keypairFromEnv("UPGRADE_AUTHORITY_KEYPAIR");
  const ix = await buildSetLp({ authority: authority.publicKey, ...(lpWallet && { lpWallet }), ...(lpDrawMax !== undefined && { lpDrawMax }), ...(lpDrawIntervalSecs !== undefined && { lpDrawIntervalSecs }) });
  if (process.argv.includes("--print-ix")) {
    console.log(JSON.stringify({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: ix.data.toString("base64") }, null, 2));
    return;
  }
  await run(conn, "set_lp", [ix], [authority]);
});

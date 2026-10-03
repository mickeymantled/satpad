// One-time setup per deployment (DECISIONS D14): creates the launch lookup table holding every account shared by all
// launches (pump globals, fee config, programs, quote mint, vault Config, fee recipients) and prints its address for
// LAUNCH_ALT (API) / NEXT_PUBLIC_LAUNCH_ALT (web). --dry-run prints the addresses without creating anything.
// Env: SOLANA_RPC_URL, LAUNCH_ALT_AUTHORITY_KEYPAIR (pays rent; becomes the table authority).
import { Keypair, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { buildBuyV2, buildCreateV2, buildDeclareCoin, coinFeePda, createLookupTable, defaultFeeRecipients, staticAccounts } from "@satpad/sdk";
import { DRY_RUN, connection, fetchConfig, keypairFromEnv } from "./lib/cli";

async function main() {
  const conn = connection();
  const config = await fetchConfig(conn);
  if (!config) throw new Error("vault Config not found on this cluster (initialize first)");
  const recipients = defaultFeeRecipients(await new OnlinePumpSdk(conn).fetchGlobal());
  const probe = async () => {
    const m = Keypair.generate().publicKey, u = Keypair.generate().publicKey;
    return [
      await buildCreateV2({ mint: m, name: "p", symbol: "p", uri: "p", creator: coinFeePda(m)[0], user: u }),
      await buildDeclareCoin({ user: u, mint: m, treasury: config.treasury, payee: { kind: "me" } }),
      ...(await buildBuyV2({ user: u, mint: m, creator: coinFeePda(m)[0], recipients, tokenAmount: 1n, maxQuoteIn: 1n })),
    ];
  };
  const addresses: PublicKey[] = staticAccounts(await probe(), await probe());
  console.log(JSON.stringify({ rpc: conn.rpcEndpoint, treasury: config.treasury.toBase58(), addresses: addresses.map((a) => a.toBase58()) }, null, 2));
  if (DRY_RUN) { console.log("(dry-run) no table created"); return; }
  const payer = keypairFromEnv("LAUNCH_ALT_AUTHORITY_KEYPAIR");
  const table = await createLookupTable(conn, payer, addresses);
  console.log(JSON.stringify({ launchAlt: table.key.toBase58(), authority: payer.publicKey.toBase58(), entries: table.state.addresses.length }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

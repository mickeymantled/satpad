// Fetches the mainnet wBTC mint (read-only), patches mint_authority to a local keypair, writes a
// `solana-test-validator --account` JSON file. Generates scripts/fork-keys/wbtc-authority.json if missing.
// Usage: npx tsx scripts/fork-prepare-mint.ts <out.json>
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const WBTC = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
const KEY = "scripts/fork-keys/wbtc-authority.json";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: fork-prepare-mint.ts <out.json>");
  mkdirSync(dirname(KEY), { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  if (!existsSync(KEY)) writeFileSync(KEY, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  const auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))));
  const conn = new Connection(process.env.FORK_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  const acct = await conn.getAccountInfo(WBTC);
  if (!acct) throw new Error("wBTC mint not found on source RPC");
  if (acct.data.length !== 82) throw new Error(`unexpected mint size ${acct.data.length}`);
  const data = Buffer.from(acct.data);
  data.writeUInt32LE(1, 0); // COption::Some
  auth.publicKey.toBuffer().copy(data, 4); // mint_authority
  writeFileSync(out, JSON.stringify({
    pubkey: WBTC.toBase58(),
    account: { lamports: acct.lamports, data: [data.toString("base64"), "base64"], owner: acct.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length },
  }));
  console.log(`patched wBTC mint -> ${out}; mint_authority=${auth.publicKey.toBase58()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// M3: seed N coins on the fork through the real launch flow with mixed payee choices, and initialize the vault with
// distinct destination wallets if needed. Writes scripts/fork-keys/seed.json (gitignored) with wallets and mints so the
// trader, keeper and reconciler share them.
// Usage: scripts/local-fork.sh --detach && pnpm fork:seed [--coins 10]
import { mkdirSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, DEFAULT_SPLIT, buildInitialize, configPda, decodeConfig, type PayeeChoice } from "@satpad/sdk";
import { RPC, ata, fundSol, fundWbtc, launchCoin, launchContext, send, KEYS_DIR } from "./lib/fork";

const N = Number(process.argv[process.argv.indexOf("--coins") + 1] || 10);

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const keys = { deployer: Keypair.generate(), admin: Keypair.generate(), treasury: Keypair.generate(), buyback: Keypair.generate(), rewards: Keypair.generate(), lp: Keypair.generate(), keeper: Keypair.generate(), trader: Keypair.generate() };
  await fundSol(conn, Object.values(keys).map((k) => k.publicKey), 50);
  // destination ATAs the vault never creates
  await send(conn, [keys.treasury, keys.buyback, keys.rewards, keys.lp, keys.keeper].map((k) => createAssociatedTokenAccountIdempotentInstruction(keys.deployer.publicKey, ata(k.publicKey), k.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM)), [keys.deployer]);
  if (!(await conn.getAccountInfo(configPda()[0]))) {
    await send(conn, [await buildInitialize({ payer: keys.deployer.publicKey, admin: keys.admin.publicKey, treasury: keys.treasury.publicKey, buybackWallet: keys.buyback.publicKey, rewardsWallet: keys.rewards.publicKey, lpWallet: keys.lp.publicKey, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, launchFeeLamports: 10_000_000n })], [keys.deployer]);
    console.log("vault initialized");
  }
  const config = decodeConfig((await conn.getAccountInfo(configPda()[0], "confirmed"))!.data);
  await fundWbtc(conn, keys.deployer, keys.trader.publicKey, 100_000_000n); // 1 wBTC for trading
  const ctx = await launchContext(conn, keys.deployer, config.treasury);
  console.log(`lookup table ${ctx.table.key.toBase58()} (${ctx.table.state.addresses.length} accounts)`);

  const coins: { mint: string; symbol: string; payee: string; launcher: string; signature: string }[] = [];
  const launchers: Keypair[] = [];
  for (let i = 0; i < N; i++) {
    const launcher = Keypair.generate();
    launchers.push(launcher);
    await fundSol(conn, [launcher.publicKey], 5);
    await fundWbtc(conn, keys.deployer, launcher.publicKey, 2_000_000n);
    const payee: PayeeChoice = i % 3 === 0 ? { kind: "me" } : i % 3 === 1 ? { kind: "wallet", wallet: Keypair.generate().publicKey } : { kind: "holders" };
    // every third "me" launcher gets a wBTC ATA (payable), the rest do not (share waits in PayeePot)
    const { mint, signature } = await launchCoin(ctx, launcher, `Seed ${i}`, `SEED${i}`, payee, 10_000_000_000n, 200_000n);
    coins.push({ mint: mint.toBase58(), symbol: `SEED${i}`, payee: payee.kind, launcher: launcher.publicKey.toBase58(), signature });
    console.log(`launched ${coins[i]!.symbol} ${mint.toBase58()} payee=${payee.kind}`);
  }
  mkdirSync(KEYS_DIR, { recursive: true });
  const dump = (k: Keypair) => Array.from(k.secretKey);
  writeFileSync(`${KEYS_DIR}/seed.json`, JSON.stringify({ rpc: RPC, lookupTable: ctx.table.key.toBase58(), wallets: Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, { pubkey: k.publicKey.toBase58(), secret: dump(k) }])), launchers: launchers.map(dump), coins, config: { treasury: config.treasury.toBase58(), buyback: config.buybackWallet.toBase58() } }, null, 2));
  writeFileSync(`${KEYS_DIR}/keeper.json`, JSON.stringify(dump(keys.keeper)));
  console.log(`seeded ${N} coins; wallets in ${KEYS_DIR}/seed.json; keeper keypair ${KEYS_DIR}/keeper.json`);
  void PublicKey;
}
main().catch((e) => { console.error(e); process.exit(1); });

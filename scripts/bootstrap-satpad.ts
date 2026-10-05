// SPEC "Bootstrapping": create $SATPAD through the normal launch flow with the treasury-only fee flag (admin is the
// launcher), drive it through the curve, migrate to PumpSwap, record pool + LP mint in Config (`set_satpad`, D21).
// On the fork every step runs here with minted wBTC; on mainnet the curve is driven by team + public buys, so run
// this in stages: `--stage launch`, then later `--stage migrate` (after completion) and `--stage register`.
// Usage: LOCAL_RPC_URL=... FORK_KEYS_DIR=... npx tsx scripts/bootstrap-satpad.ts [--stage launch|buyout|migrate|register|all] [--uri <metadata uri>] [--dry-run]
// Env: ADMIN_KEYPAIR (mainnet) — on the fork the admin comes from <FORK_KEYS_DIR>/seed.json.
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, canonicalPumpPoolPdaWithQuote } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, PUMP_AMM_PROGRAM_ID, buildBuyV2, buildCreateV2, buildDeclareCoin, buildSetSatpad, coinFeePda, defaultFeeRecipients, lpMintForPool, quoteSatsForTokens } from "@satpad/sdk";
import { KEYS_DIR, RPC, fundWbtc, send } from "./lib/fork";
import { DRY_RUN, arg, fetchConfig, run } from "./lib/cli";

type Seed = { lookupTable: string; wallets: Record<string, { pubkey: string; secret: number[] }>; satpad?: { mint: string; pool: string; lpMint: string; launchSig?: string; migrateSig?: string } };

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const seedPath = `${KEYS_DIR}/seed.json`;
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  const admin = process.env["ADMIN_KEYPAIR"] ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env["ADMIN_KEYPAIR"], "utf8")))) : Keypair.fromSecretKey(Uint8Array.from(seed.wallets["admin"]!.secret));
  const stage = arg("stage") ?? "all";
  const uri = arg("uri") ?? "https://satpad.invalid/SATPAD.json";
  const config = await fetchConfig(conn);
  if (!config) throw new Error("vault Config not found");
  if (!config.admin.equals(admin.publicKey)) throw new Error(`admin keypair ${admin.publicKey.toBase58()} is not Config.admin ${config.admin.toBase58()}`);
  const sdk = new OnlinePumpSdk(conn);
  const global = await sdk.fetchGlobal();
  const save = (patch: Partial<NonNullable<Seed["satpad"]>>) => { seed.satpad = { ...(seed.satpad ?? { mint: "", pool: "", lpMint: "" }), ...patch }; writeFileSync(seedPath, JSON.stringify(seed, null, 2)); };
  const want = (s: string) => stage === "all" || stage === s;

  // 1. launch: create_v2 (creator = CoinFee) + declare_coin(treasury_only = true) in one v0 tx over the launch table.
  let mint = seed.satpad?.mint ? new PublicKey(seed.satpad.mint) : null;
  if (want("launch")) {
    if (mint) console.log(`launch: already launched ${mint.toBase58()}`);
    else {
      const mintKp = Keypair.generate();
      const [coinFee] = coinFeePda(mintKp.publicKey);
      const ixs = [
        await buildCreateV2({ mint: mintKp.publicKey, name: "Satpad", symbol: "SATPAD", uri, creator: coinFee, user: admin.publicKey }),
        await buildDeclareCoin({ user: admin.publicKey, mint: mintKp.publicKey, treasury: config.treasury, payee: { kind: "me" }, treasuryOnly: true }),
      ];
      console.log("launch plan:", { mint: mintKp.publicKey.toBase58(), coinFee: coinFee.toBase58(), launcher: admin.publicKey.toBase58(), treasuryOnly: true, uri });
      if (DRY_RUN) { console.log("(dry-run) stopping before launch"); return; }
      const table = (await conn.getAddressLookupTable(new PublicKey(seed.lookupTable))).value;
      if (!table) throw new Error("launch lookup table not found");
      const sig = await send(conn, ixs, [admin, mintKp], [table], 400_000);
      mint = mintKp.publicKey; save({ mint: mint.toBase58(), launchSig: sig });
      console.log(`launched $SATPAD ${mint.toBase58()} (${sig})`);
    }
  }
  if (!mint) throw new Error("no $SATPAD mint yet — run --stage launch");

  // 2. buy-out (fork only): mint wBTC and buy all real reserves so the curve completes.
  if (want("buyout")) {
    const curve = await sdk.fetchBondingCurve(mint);
    if (curve.complete) console.log("buyout: curve already complete");
    else {
      const tokens = BigInt(curve.realTokenReserves.toString());
      const cost = quoteSatsForTokens({ global, feeConfig: await sdk.fetchFeeConfig(), quoteControl: await sdk.fetchQuoteControl(), mintSupply: BigInt(curve.tokenTotalSupply.toString()), bondingCurve: curve }, tokens);
      const maxQuoteIn = cost + cost / 50n + 1n;
      console.log("buyout plan:", { tokens: tokens.toString(), costSats: cost.toString() });
      if (DRY_RUN) { console.log("(dry-run) stopping before buy-out"); return; }
      await fundWbtc(conn, admin, admin.publicKey, maxQuoteIn);
      const sig = await send(conn, await buildBuyV2({ user: admin.publicKey, mint, creator: curve.creator, recipients: defaultFeeRecipients(global), tokenAmount: tokens, maxQuoteIn }), [admin], [], 400_000);
      if (!(await sdk.fetchBondingCurve(mint)).complete) throw new Error("curve not complete after buy-out");
      console.log(`buy-out ${sig}; curve complete`);
    }
  }

  // 3. migrate_v2 (permissionless, V17) → PumpSwap pool.
  const pool = canonicalPumpPoolPdaWithQuote(mint, BTC_QUOTE_MINT), lpMint = lpMintForPool(pool);
  if (want("migrate")) {
    const info = await conn.getAccountInfo(pool, "confirmed");
    if (info?.owner.equals(PUMP_AMM_PROGRAM_ID)) console.log(`migrate: pool already exists ${pool.toBase58()}`);
    else {
      if (!(await sdk.fetchBondingCurve(mint)).complete) throw new Error("curve not complete; cannot migrate yet");
      console.log("migrate plan:", { pool: pool.toBase58(), lpMint: lpMint.toBase58() });
      if (DRY_RUN) { console.log("(dry-run) stopping before migrate"); return; }
      const ix = await PUMP_SDK.migrateV2Instruction({ withdrawAuthority: global.withdrawAuthority, mint, user: admin.publicKey, quoteMint: BTC_QUOTE_MINT, baseTokenProgram: COIN_TOKEN_PROGRAM, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM });
      const sig = await send(conn, [ix], [admin], [], 600_000);
      save({ pool: pool.toBase58(), lpMint: lpMint.toBase58(), migrateSig: sig });
      console.log(`migrated ${sig}; pool ${pool.toBase58()}`);
    }
  }

  // 4. set_satpad (admin, write-once, D21).
  if (want("register")) {
    const cfg = (await fetchConfig(conn))!;
    if (!cfg.satpadPool.equals(PublicKey.default)) console.log(`register: Config already has pool ${cfg.satpadPool.toBase58()}`);
    else {
      const poolInfo = await conn.getAccountInfo(pool, "confirmed");
      if (!poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error("pool does not exist yet; migrate first");
      await run(conn, "set_satpad", [await buildSetSatpad(admin.publicKey, { satpadMint: mint, satpadPool: pool, satpadLpMint: lpMint })], [admin]);
      if (!DRY_RUN) { save({ mint: mint.toBase58(), pool: pool.toBase58(), lpMint: lpMint.toBase58() }); const after = await fetchConfig(conn); console.log("Config:", { satpadMint: after!.satpadMint.toBase58(), satpadPool: after!.satpadPool.toBase58(), satpadLpMint: after!.satpadLpMint.toBase58() }); }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

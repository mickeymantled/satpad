// Milestone 2 definition of done: on the local mainnet fork, a coin's creator fee settles four ways through
// satpad_vault. Launch = create_v2 (creator = CoinFee PDA) + declare_coin (launch fee inside) + first buy_v2 in ONE
// transaction (SPEC "Creation (one transaction)"); then more buys, pump's permissionless collect_creator_fee_v2,
// satpad_vault::settle, pay_payee. Asserts every destination balance against @satpad/sdk splitFee.
//
// Run:  scripts/local-fork.sh --detach && pnpm fork:m2 [--dry-run]
import { readFileSync } from "node:fs";
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import {
  BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, COIN_TOKEN_PROGRAM, DEFAULT_SPLIT, buildBuyV2, buildCollectCreatorFeeV2, buildCreateV2, buildDeclareCoin, buildInitialize,
  buildPayPayee, buildSettle, buildV0Transaction, coinAccounts, coinFeePda, coinPda, configPda, createLookupTable, decodeCoin, decodeConfig, lpPotPda, payeePotPda, parseVaultEvents,
  quoteSatsForTokens, sats, splitFee, staticAccounts, toUi, defaultFeeRecipients,
} from "@satpad/sdk";

const DRY = process.argv.includes("--dry-run");
const RPC = process.env["LOCAL_RPC_URL"] ?? "http://127.0.0.1:8899";
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(BTC_QUOTE_MINT, owner, true, BTC_QUOTE_TOKEN_PROGRAM);
const bal = async (conn: Connection, a: PublicKey) => getAccount(conn, a, "confirmed", BTC_QUOTE_TOKEN_PROGRAM).then((x) => x.amount).catch(() => 0n);

async function send(conn: Connection, label: string, ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []): Promise<string> {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }), ...ixs];
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  let size: number, sim, sendIt: () => Promise<string>;
  if (tables.length) {
    const tx = buildV0Transaction(signers[0]!.publicKey, blockhash, all, tables);
    tx.sign(signers);
    size = tx.serialize().length;
    sim = await conn.simulateTransaction(tx);
    sendIt = async () => { const sig = await conn.sendTransaction(tx); await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed"); return sig; };
  } else {
    const tx = new Transaction().add(...all);
    tx.feePayer = signers[0]!.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    size = tx.serialize().length;
    sim = await conn.simulateTransaction(tx);
    sendIt = () => sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  }
  if (sim.value.err) throw new Error(`${label} simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
  const events = parseVaultEvents(sim.value.logs ?? []).map((e) => e.name);
  console.log(`${label}: simulated ok, ${sim.value.unitsConsumed} CU, ${size} bytes${tables.length ? " (v0 + ALT)" : ""}${events.length ? `, events ${events.join(",")}` : ""}`);
  if (DRY) return "(dry-run)";
  const sig = await sendIt();
  console.log(`${label}: ${sig}`);
  return sig;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  if (DRY) console.log("dry-run: nothing will be sent");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync("scripts/fork-keys/wbtc-authority.json", "utf8"))));
  const deployer = Keypair.generate(); // vault deployer + admin for this test
  // Distinct destination wallets: the program refuses the same mutable account twice (Anchor duplicate-mutable check).
  const treasury = Keypair.generate(), buyback = Keypair.generate(), rewards = Keypair.generate(), lp = Keypair.generate();
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const [coinFee] = coinFeePda(mint.publicKey);
  for (const k of [deployer, user, authority]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");

  // Fork-only: wBTC for the buyer, and ATAs for the vault's destination wallets (the vault never creates them).
  await send(conn, "setup", [
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, ata(user.publicKey), user.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM),
    createMintToInstruction(BTC_QUOTE_MINT, ata(user.publicKey), authority.publicKey, 10_000_000n, [], BTC_QUOTE_TOKEN_PROGRAM), // 0.1 wBTC
    ...[treasury, buyback, rewards, lp].map((w) => createAssociatedTokenAccountIdempotentInstruction(user.publicKey, ata(w.publicKey), w.publicKey, BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM)),
  ], [user, authority]);

  // 1. initialize the vault (skip if a previous run did)
  const d = deployer.publicKey;
  if (!(await conn.getAccountInfo(configPda()[0]))) {
    await send(conn, "initialize", [await buildInitialize({ payer: d, admin: d, treasury: treasury.publicKey, buybackWallet: buyback.publicKey, rewardsWallet: rewards.publicKey, lpWallet: lp.publicKey, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, launchFeeLamports: 10_000_000n })], [deployer]);
  }
  const config = decodeConfig((await conn.getAccountInfo(configPda()[0], "confirmed"))!.data);
  if (DRY) { console.log("dry-run: stopping before launch (later steps need on-chain state)"); return; }

  // 2. Launch: create_v2 + declare_coin + first buy, atomically.
  const online = new OnlinePumpSdk(conn);
  const [global, feeConfig, quoteControl] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl()]);
  const recipients = defaultFeeRecipients(global);
  const firstBuyTokens = 10_000_000_000n; // 10,000 tokens
  const firstBuyQuote = quoteSatsForTokens({ global, feeConfig, mintSupply: null, bondingCurve: null, quoteControl, creatorFeeBps: 100 }, firstBuyTokens);
  const launchIxs = [
    await buildCreateV2({ mint: mint.publicKey, name: "Satpad M2", symbol: "SPM2", uri: "https://satpad.invalid/m2.json", creator: coinFee, user: user.publicKey }),
    await buildDeclareCoin({ user: user.publicKey, mint: mint.publicKey, treasury: config.treasury, payee: { kind: "me" } }),
    ...(await buildBuyV2({ user: user.publicKey, mint: mint.publicKey, creator: coinFee, recipients, tokenAmount: firstBuyTokens, maxQuoteIn: sats((firstBuyQuote * 105n) / 100n + 1n) })),
  ];
  // One-time lookup table of launch-static accounts (production pins its address; the fork creates it fresh).
  const probe = Keypair.generate(), probeUser = Keypair.generate();
  const probeIxs = [
    await buildCreateV2({ mint: probe.publicKey, name: "p", symbol: "p", uri: "p", creator: coinFeePda(probe.publicKey)[0], user: probeUser.publicKey }),
    await buildDeclareCoin({ user: probeUser.publicKey, mint: probe.publicKey, treasury: config.treasury, payee: { kind: "me" } }),
    ...(await buildBuyV2({ user: probeUser.publicKey, mint: probe.publicKey, creator: coinFeePda(probe.publicKey)[0], recipients, tokenAmount: 1n, maxQuoteIn: 1n })),
  ];
  const table = await createLookupTable(conn, deployer, staticAccounts(launchIxs, probeIxs));
  console.log(`lookup table ${table.key.toBase58()} with ${table.state.addresses.length} static launch accounts`);
  const treasuryLamportsBefore = await conn.getBalance(config.treasury);
  const launchSig = await send(conn, "launch (create_v2 + declare_coin + buy_v2)", launchIxs, [user, mint], [table]);
  const coin = decodeCoin((await conn.getAccountInfo(coinPda(mint.publicKey)[0], "confirmed"))!.data);
  const launchFeePaid = BigInt(await conn.getBalance(config.treasury) - treasuryLamportsBefore);

  // 3. More trading so a meaningful creator fee accrues.
  const buySigs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const curve = PUMP_SDK.decodeBondingCurve((await conn.getAccountInfo(bondingCurvePda(mint.publicKey), "confirmed"))!);
    const tokens = 50_000_000_000n + BigInt(i) * 1_000_000n; // ~50,000 tokens; varied so no two buys are byte-identical
    const q = quoteSatsForTokens({ global, feeConfig, mintSupply: BigInt(curve.tokenTotalSupply.toString()), bondingCurve: curve, quoteControl }, tokens);
    buySigs.push(await send(conn, `buy_v2 #${i + 2}`, await buildBuyV2({ user: user.publicKey, mint: mint.publicKey, creator: coinFee, recipients, tokenAmount: tokens, maxQuoteIn: sats((q * 105n) / 100n + 1n) }), [user]));
  }
  const accounts = coinAccounts(mint.publicKey, coinFee);
  const accruedInPumpVault = await bal(conn, accounts.creatorVaultQuoteAta);

  // 4. Permissionless collect (anyone; here the buyer) → CoinFee ATA.
  const collectSig = await send(conn, "collect_creator_fee_v2", [await buildCollectCreatorFeeV2(coinFee)], [user]);
  const feeInCoinFee = await bal(conn, accounts.creatorQuoteAta);

  // 5. settle → four ways; 6. pay_payee → deployer... wait, payee = Me = the launcher (user).
  const before = { lp: await bal(conn, lpPotPda()[0]), buyback: await bal(conn, ata(config.buybackWallet)), treasury: await bal(conn, ata(config.treasury)), payeePot: await bal(conn, payeePotPda(mint.publicKey)[0]) };
  const settleSig = await send(conn, "settle", [await buildSettle({ mint: mint.publicKey, buybackWallet: config.buybackWallet, treasury: config.treasury })], [user]);
  const after = { lp: await bal(conn, lpPotPda()[0]), buyback: await bal(conn, ata(config.buybackWallet)), treasury: await bal(conn, ata(config.treasury)), payeePot: await bal(conn, payeePotPda(mint.publicKey)[0]) };
  const got = { liquidity: after.lp - before.lp, buyback: after.buyback - before.buyback, operator: after.treasury - before.treasury, deployer: after.payeePot - before.payeePot };
  const expected = splitFee(feeInCoinFee, config.split);
  const payeeBefore = await bal(conn, ata(coin.payee));
  const paySig = await send(conn, "pay_payee", [await buildPayPayee({ mint: mint.publicKey, payee: coin.payee })], [user]);
  const payeeGot = (await bal(conn, ata(coin.payee))) - payeeBefore;

  const result = { rpc: RPC, mint: mint.publicKey.toBase58(), coinFee: coinFee.toBase58(), launchSig, buySigs, collectSig, settleSig, paySig,
    launchFeeLamports: launchFeePaid.toString(), accruedInPumpVaultSats: accruedInPumpVault.toString(), feeCollectedSats: feeInCoinFee.toString(), feeUi: toUi(feeInCoinFee),
    split: config.split, got: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.toString()])), expected: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.toString()])), payeeGotSats: payeeGot.toString() };
  console.log(JSON.stringify(result, null, 2));
  const checks: [string, boolean][] = [
    ["coin registered with payee = launcher, creator = CoinFee", coin.declared && coin.payee.equals(user.publicKey)],
    ["launch fee reached treasury", launchFeePaid === config.launchFeeLamports],
    ["creator fee accrued in pump creator_vault and was collected into CoinFee ATA", accruedInPumpVault > 0n && feeInCoinFee === accruedInPumpVault],
    ["CoinFee ATA empty after settle", (await bal(conn, accounts.creatorQuoteAta)) === 0n],
    ["liquidity share == splitFee", got.liquidity === expected.liquidity],
    ["buyback share == splitFee", got.buyback === expected.buyback],
    ["operator share == splitFee", got.operator === expected.operator],
    ["deployer share == splitFee", got.deployer === expected.deployer],
    ["four shares sum to the fee", got.liquidity + got.buyback + got.operator + got.deployer === feeInCoinFee],
    ["pay_payee delivered the deployer share", payeeGot === expected.deployer],
  ];
  let ok = true;
  for (const [n, p] of checks) { console.log(`${p ? "PASS" : "FAIL"} ${n}`); ok &&= p; }
  if (!ok) throw new Error("M2 definition of done NOT met");
  console.log("M2 definition of done: met");
  void COIN_TOKEN_PROGRAM;
}
main().catch((e) => { console.error(e); process.exit(1); });

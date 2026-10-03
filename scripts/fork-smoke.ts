// M1 smoke test on the local fork (scripts/local-fork.sh --detach): create_v2 + buy_v2 quoted in wBTC.
// Run: npx tsx scripts/fork-smoke.ts   (RPC: LOCAL_RPC_URL, default http://127.0.0.1:8899)
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { readFileSync } from "node:fs";

const WBTC = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
// Pinned to the accounts cloned by local-fork.sh (the SDK would otherwise pick random recipients).
const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const BUYBACK_FEE_RECIPIENT = new PublicKey("9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7");

async function send(conn: Connection, label: string, ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs);
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    console.log(`${label} signature: ${sig}`);
    return sig;
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs;
    console.error(`${label} FAILED`, (e as Error).message, logs ? "\n" + logs.join("\n") : "");
    throw e;
  }
}

async function main() {
  const conn = new Connection(process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync("scripts/fork-keys/wbtc-authority.json", "utf8"))));
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const creator = Keypair.generate().publicKey; // plain pubkey: must NOT need to sign
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(authority.publicKey, 1 * LAMPORTS_PER_SOL), "confirmed");

  const userWbtc = getAssociatedTokenAddressSync(WBTC, user.publicKey, false, TOKEN_PROGRAM_ID);
  await send(conn, "mint wBTC", [
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, userWbtc, user.publicKey, WBTC, TOKEN_PROGRAM_ID),
    createMintToInstruction(WBTC, userWbtc, authority.publicKey, 1_000_000n, [], TOKEN_PROGRAM_ID), // 0.01 wBTC (8 dec)
  ], [user, authority]);
  const mintedBal = (await getAccount(conn, userWbtc, "confirmed", TOKEN_PROGRAM_ID)).amount;
  if (mintedBal !== 1_000_000n) throw new Error(`wBTC balance ${mintedBal}`);

  const createIx = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey, name: "Satpad Test", symbol: "SPT", uri: "https://example.invalid/m.json",
    creator, user: user.publicKey, mayhemMode: false,
    quoteMint: WBTC, quoteTokenProgram: TOKEN_PROGRAM_ID, creatorFeeBps: new BN(100),
  });
  const createSig = await send(conn, "create_v2", [createIx], [user, mint]);

  const sdk = new OnlinePumpSdk(conn);
  const global = await sdk.fetchGlobal();
  const state = await sdk.fetchBuyState(mint.publicKey, user.publicKey, TOKEN_2022_PROGRAM_ID, WBTC);
  const quoteAmount = new BN(10_000); // 0.0001 wBTC
  const amount = new BN(1_000_000_000); // 1000 tokens (6 dec); curve price decides actual cost, slippage-capped below
  void global;
  const buyIxs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, true, TOKEN_2022_PROGRAM_ID), user.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    await PUMP_SDK.getBuyV2InstructionRaw({
      user: user.publicKey, mint: mint.publicKey, creator: state.bondingCurve.creator, amount,
      quoteAmount: quoteAmount.muln(2), feeRecipient: FEE_RECIPIENT, buybackFeeRecipient: BUYBACK_FEE_RECIPIENT,
      tokenProgram: TOKEN_2022_PROGRAM_ID, quoteMint: WBTC, quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
  ];
  const buySig = await send(conn, "buy_v2", buyIxs, [user]);

  const curveInfo = await conn.getAccountInfo(bondingCurvePda(mint.publicKey), "confirmed");
  if (!curveInfo) throw new Error("bonding curve missing");
  const bc = PUMP_SDK.decodeBondingCurve(curveInfo);
  const userTokens = (await getAccount(conn, getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, true, TOKEN_2022_PROGRAM_ID), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const wbtcAfter = (await getAccount(conn, userWbtc, "confirmed", TOKEN_PROGRAM_ID)).amount;
  console.log(JSON.stringify({
    mint: mint.publicKey.toBase58(), createSig, buySig,
    bondingCurve: {
      quote_mint: bc.quoteMint.toBase58(), creator: bc.creator.toBase58(), creator_fee_bps: bc.creatorFeeBps.toString(),
      virtual_token_reserves: bc.virtualTokenReserves.toString(), virtual_quote_reserves: bc.virtualQuoteReserves?.toString?.(),
      real_token_reserves: bc.realTokenReserves.toString(), is_mayhem_mode: bc.isMayhemMode,
    },
    creatorMatches: bc.creator.equals(creator), quoteMatches: bc.quoteMint.equals(WBTC),
    userTokens: userTokens.toString(), wbtcSpent: (mintedBal - wbtcAfter).toString(),
  }, null, 2));
  if (!bc.quoteMint.equals(WBTC) || !bc.creator.equals(creator) || bc.creatorFeeBps.toString() !== "100") throw new Error("curve fields mismatch");
  if (userTokens === 0n) throw new Error("buy gave no tokens");
}
main().catch((e) => { console.error(e); process.exit(1); });

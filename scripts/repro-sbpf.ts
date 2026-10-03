// VERIFIED V14 repro runner. Against the local fork (scripts/local-fork.sh, which loads target/deploy/sbpf_repro.so):
// init a Rec at PDA ["rec", mint] then run every check_* variant; print PASS/FAIL with the program's own logs.
// Build the repro for an arch first:  cargo build-sbf --arch v3 --manifest-path programs/sbpf_repro/Cargo.toml
import { readFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, getAssociatedTokenAddressSync, MINT_SIZE, getMinimumBalanceForRentExemptMint } from "@solana/spl-token";

const RPC = process.env["LOCAL_RPC_URL"] ?? "http://127.0.0.1:8899";
const idl = JSON.parse(readFileSync("target/idl/sbpf_repro.json", "utf8")) as Idl;
const PROGRAM_ID = new PublicKey(idl.address);

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
  const program = new Program(idl, new AnchorProvider(conn, { publicKey: payer.publicKey, signTransaction: () => Promise.reject(), signAllTransactions: () => Promise.reject() }, {}));
  const so = readFileSync("target/deploy/sbpf_repro.so");
  console.log(`sbpf_repro.so SBPF v${so.readUInt32LE(48)} (${so.length} bytes) on ${RPC}`);

  const mint = Keypair.generate();
  const [rec] = PublicKey.findProgramAddressSync([Buffer.from("rec"), mint.publicKey.toBuffer()], PROGRAM_ID);
  const send = async (label: string, ix: TransactionInstruction, signers: Keypair[]) => {
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(...signers);
    const sim = await conn.simulateTransaction(tx);
    const logs = (sim.value.logs ?? []).filter((l) => /Program log:/.test(l) && !/Instruction:/.test(l)).map((l) => "    " + l.replace("Program log: ", ""));
    console.log(`${sim.value.err ? "FAIL" : "PASS"} ${label}${sim.value.err ? " " + JSON.stringify(sim.value.err) : ""}`);
    if (logs.length) console.log(logs.join("\n"));
    if (!sim.value.err && label === "init_rec") await conn.sendTransaction(tx, signers).then((s) => conn.confirmTransaction(s, "confirmed"));
  };
  await send("init_rec", await program.methods["initRec"]!().accounts({ payer: payer.publicKey, mint: mint.publicKey, rec, systemProgram: SystemProgram.programId }).instruction(), [payer]);
  const accts = { mint: mint.publicKey, rec };
  await send("check_seeds_has_one (settle shape: seeds+stored bump+has_one, Unchecked key())", await program.methods["checkSeedsHasOne"]!().accounts(accts).instruction(), [payer]);
  await send("check_has_one (has_one only)", await program.methods["checkHasOne"]!().accounts(accts).instruction(), [payer]);
  await send("check_seeds (seeds + stored bump only)", await program.methods["checkSeeds"]!().accounts(accts).instruction(), [payer]);
  await send("check_seeds_find (seeds + canonical bump only)", await program.methods["checkSeedsFind"]!().accounts(accts).instruction(), [payer]);
  await send("check_signer (same as first but mint is a Signer)", await program.methods["checkSigner"]!().accounts(accts).instruction(), [payer, mint]);
  await send("check_manual (no constraints; handler compares and logs)", await program.methods["checkManual"]!().accounts(accts).instruction(), [payer]);
  const fill = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, Keypair.generate().publicKey]));
  await send("check_many_unchecked (settle shape + 10 UncheckedAccount)", await program.methods["checkManyUnchecked"]!().accounts({ ...accts, ...fill }).instruction(), [payer]);
  // real SPL mint + 6 ATAs for the token variant
  const quote = Keypair.generate();
  const owners = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
  const setup = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: quote.publicKey, space: MINT_SIZE, lamports: await getMinimumBalanceForRentExemptMint(conn), programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(quote.publicKey, 8, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ...owners.map((o) => createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, getAssociatedTokenAddressSync(quote.publicKey, o, true), o, quote.publicKey, TOKEN_PROGRAM_ID)),
  );
  setup.feePayer = payer.publicKey; setup.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; setup.sign(payer, quote);
  await conn.confirmTransaction(await conn.sendTransaction(setup, [payer, quote]), "confirmed");
  const t = owners.map((o) => getAssociatedTokenAddressSync(quote.publicKey, o, true));
  await send("check_many_token (settle shape + 6 InterfaceAccount<TokenAccount>, 3 with associated_token constraints)", await program.methods["checkManyToken"]!().accounts({
    ...accts, owner0: owners[0]!, owner1: owners[1]!, owner2: owners[2]!, t0: t[0]!, t1: t[1]!, t2: t[2]!, t3: t[3]!, t4: t[4]!, t5: t[5]!, quoteMint: quote.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).instruction(), [payer]);
}
main().catch((e) => { console.error(e); process.exit(1); });

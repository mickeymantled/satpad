// LiteSVM harness for satpad_vault (DECISIONS D9: bankrun cannot load an Anchor 1.2 / SBPF v3 binary).
// LiteSVM ≥ 1.0 is typed against @solana/kit; everything else in this repo is web3.js v1, so transactions are
// built with web3.js, serialized, and decoded into kit's wire format here. Tests never touch kit directly.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, BorshCoder, Program, type Idl } from "@coral-xyz/anchor";
import { LiteSVM, type FailedTransactionMetadata, type TransactionMetadata } from "litesvm";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { unpackAccount, type Account as TokenAccount } from "@solana/spl-token";
import { MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction, getMinimumBalanceForRentExemptMint } from "@solana/spl-token";
import { SATPAD_VAULT_PROGRAM_ID } from "@satpad/sdk";

const ROOT = path.resolve(__dirname, "../..");
export const IDL = JSON.parse(readFileSync(path.join(ROOT, "target/idl/satpad_vault.json"), "utf8")) as Idl;
const SO = path.join(ROOT, "target/deploy/satpad_vault.so");

export class VaultSvm {
  readonly svm: LiteSVM;
  readonly program: Program;
  readonly coder: BorshCoder;
  readonly payer: Keypair;

  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(address(SATPAD_VAULT_PROGRAM_ID.toBase58()), SO);
    this.payer = Keypair.generate();
    this.airdrop(this.payer.publicKey, 100n * 1_000_000_000n);
    // LiteSVM starts at unix time 0; give it a real-looking clock so timestamps and intervals behave.
    const clock = this.svm.getClock();
    clock.unixTimestamp = 1_750_000_000n;
    this.svm.setClock(clock);
    const provider = new AnchorProvider(new Connection("http://127.0.0.1:1"), { publicKey: this.payer.publicKey, signTransaction: () => Promise.reject(), signAllTransactions: () => Promise.reject() }, {});
    this.program = new Program(IDL, provider);
    this.coder = new BorshCoder(IDL);
  }

  airdrop(to: PublicKey, lam: bigint): void {
    this.svm.airdrop(address(to.toBase58()), lamports(lam));
  }

  /** Signs with `signers` (first is fee payer) and sends. Throws with program logs on failure. */
  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0]!.publicKey;
    // Fresh blockhash per send so byte-identical retries are not rejected as duplicate signatures.
    this.svm.expireBlockhash();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.sign(...signers);
    const res = this.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
    if (isFailed(res)) {
      const logs = res.meta().logs().join("\n");
      throw new SvmError(`${JSON.stringify(res.err())}\n${logs}`, logs);
    }
    return res;
  }

  /** Expects the transaction to fail with the given Anchor error name (or code). */
  expectFail(ixs: TransactionInstruction[], signers: Keypair[], errorName: string): void {
    try {
      this.send(ixs, signers);
    } catch (e) {
      const err = IDL.errors?.find((x) => x.name === errorName);
      const needle = err ? `Error Code: ${errorName}` : errorName;
      if (!(e instanceof SvmError) || !e.logs.includes(needle)) {
        throw new Error(`expected failure "${errorName}" but got:\n${(e as Error).message}`);
      }
      return;
    }
    throw new Error(`expected failure "${errorName}" but transaction succeeded`);
  }

  accountData(pk: PublicKey): Buffer | null {
    const a = this.svm.getAccount(address(pk.toBase58()));
    return a.exists ? Buffer.from(a.data) : null;
  }

  accountOwner(pk: PublicKey): PublicKey | null {
    const a = this.svm.getAccount(address(pk.toBase58()));
    return a.exists ? new PublicKey(a.programAddress) : null;
  }

  decode<T>(name: string, pk: PublicKey): T {
    const data = this.accountData(pk);
    if (!data) throw new Error(`account ${pk.toBase58()} not found`);
    return this.coder.accounts.decode(name, data) as T;
  }

  /** Creates an SPL mint with `decimals`, authority = payer. Returns the mint pubkey. */
  createMint(decimals: number): PublicKey {
    const mint = Keypair.generate();
    const rent = BigInt(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    this.send([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: Number(rent), programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, decimals, this.payer.publicKey, null, TOKEN_PROGRAM_ID),
    ], [this.payer, mint]);
    return mint.publicKey;
  }

  /** Writes a raw account (any owner, loaded program or not). Used to inject pump.fun state. */
  setAccount(pk: PublicKey, owner: PublicKey, data: Uint8Array, lam = 10_000_000n): void {
    this.svm.setAccount({ address: address(pk.toBase58()), programAddress: address(owner.toBase58()), data, lamports: lamports(lam), executable: false, space: BigInt(data.length) });
  }

  lamportsOf(pk: PublicKey): bigint {
    const a = this.svm.getAccount(address(pk.toBase58()));
    return a.exists ? BigInt(a.lamports) : 0n;
  }

  tokenAccount(pk: PublicKey): TokenAccount {
    const data = this.accountData(pk);
    if (!data) throw new Error(`token account ${pk.toBase58()} not found`);
    return unpackAccount(pk, { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 0 } as never, TOKEN_PROGRAM_ID);
  }

  /** Installs `authority` as the program's upgrade authority by patching the ProgramData header LiteSVM created. */
  setUpgradeAuthority(authority: PublicKey | null): void {
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const [pd] = PublicKey.findProgramAddressSync([SATPAD_VAULT_PROGRAM_ID.toBuffer()], loader);
    const data = Buffer.from(this.accountData(pd)!);
    // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> } after a u32 tag (=3)
    if (data.readUInt32LE(0) !== 3) throw new Error("not a ProgramData account");
    data.writeUInt8(authority ? 1 : 0, 12);
    (authority ?? PublicKey.default).toBuffer().copy(data, 13);
    this.setAccount(pd, loader, data, this.lamportsOf(pd));
  }

  programDataAddress(): PublicKey {
    return PublicKey.findProgramAddressSync([SATPAD_VAULT_PROGRAM_ID.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0];
  }

  /** Current unix timestamp on the SVM clock. */
  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }

  /** Advances the clock by `secs` (keeps slot moving too). */
  warp(secs: bigint): void {
    const c = this.svm.getClock();
    c.unixTimestamp = c.unixTimestamp + secs;
    c.slot = c.slot + 1n;
    this.svm.setClock(c);
    this.svm.expireBlockhash();
  }
}

export class SvmError extends Error {
  constructor(msg: string, readonly logs: string) { super(msg); }
}

function isFailed(r: TransactionMetadata | FailedTransactionMetadata): r is FailedTransactionMetadata {
  return typeof (r as FailedTransactionMetadata).err === "function";
}

void getMinimumBalanceForRentExemptMint;

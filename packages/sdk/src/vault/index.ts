// satpad_vault client: instruction builders (bigint in, TransactionInstruction out, every PDA derived here), account
// decoders onto the types in ../types.ts, and an event parser for the Ledger. Generated from the committed IDL
// (idl.json, refreshed by scripts/build-vault.sh), so the SDK never needs target/.
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, BorshCoder, EventParser, Program, type Idl } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
import BN from "bn.js";
import type { Coin, Config, PayeeMode, RewardsRun } from "../types";
import type { FeeSplitBps } from "../amounts";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM } from "../quoteMints";
import { SATPAD_VAULT_PROGRAM_ID, coinFeePda, coinPda, configPda, lpPotPda, payeePotPda, rewardsPotPda, rewardsRunPda } from "../pda";
import idlJson from "./idl.json";
import { bondingCurvePda } from "@pump-fun/pump-sdk";

export const VAULT_IDL = idlJson as Idl;
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** `ProgramData` account of the vault program (upgrade authority lives here). */
export const vaultProgramData = (programId = SATPAD_VAULT_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_ID)[0];

const coder = new BorshCoder(VAULT_IDL);
const parser = new EventParser(SATPAD_VAULT_PROGRAM_ID, coder);

/** Offline Anchor `Program` for building instructions; the connection is never used by `.instruction()`. */
export function vaultProgram(connection = new Connection("http://127.0.0.1:1")): Program {
  const wallet = { publicKey: PublicKey.default, signTransaction: () => Promise.reject(new Error("offline")), signAllTransactions: () => Promise.reject(new Error("offline")) };
  return new Program(VAULT_IDL, new AnchorProvider(connection, wallet, {}));
}
const program = vaultProgram();

const bn = (v: bigint) => new BN(v.toString());
const big = (v: BN) => BigInt(v.toString());
const ata = (owner: PublicKey, quoteMint: PublicKey) => getAssociatedTokenAddressSync(quoteMint, owner, true, BTC_QUOTE_TOKEN_PROGRAM);

// ---------- decoders ----------

type RawSplit = { liquidity_bps: number; buyback_bps: number; operator_bps: number; deployer_bps: number };
const split = (s: RawSplit): FeeSplitBps => ({ liquidityBps: s.liquidity_bps, buybackBps: s.buyback_bps, operatorBps: s.operator_bps, deployerBps: s.deployer_bps });
const payeeMode = (m: Record<string, unknown>): PayeeMode => ("Holders" in m ? "holders" : "wallet");

export function decodeConfig(data: Buffer): Config {
  const r = coder.accounts.decode("Config", data);
  return {
    admin: r.admin, treasury: r.treasury, buybackWallet: r.buyback_wallet, rewardsWallet: r.rewards_wallet, lpWallet: r.lp_wallet,
    quoteMint: r.quote_mint, quoteDecimals: r.quote_decimals, split: split(r.split), lpDrawMax: big(r.lp_draw_max),
    lpDrawIntervalSecs: big(r.lp_draw_interval), creatorFeeBps: r.creator_fee_bps, paused: r.paused, launchFeeLamports: big(r.launch_fee_lamports),
    satpadMint: r.satpad_mint, satpadPool: r.satpad_pool, satpadLpMint: r.satpad_lp_mint, lastLpDrawTs: big(r.last_lp_draw_ts),
  };
}

export function decodeCoin(data: Buffer): Coin {
  const r = coder.accounts.decode("Coin", data);
  return {
    mint: r.mint, deployer: r.deployer, payee: r.payee, payeeMode: payeeMode(r.payee_mode), paused: r.paused, createdAt: big(r.created_at),
    declared: r.declared, treasuryOnly: r.treasury_only, lastRewardsRunTs: big(r.last_rewards_run_ts), rewardsRunCount: big(r.rewards_run_count),
  };
}

export function decodeRewardsRun(data: Buffer): RewardsRun {
  const r = coder.accounts.decode("RewardsRun", data);
  return { mint: r.mint, runIndex: big(r.run_index), snapshotSha256: Uint8Array.from(r.snapshot_sha256), slot: big(r.slot), amountReleased: big(r.amount_released), timestamp: big(r.timestamp) };
}

// ---------- events ----------

export interface VaultEvent { name: string; data: Record<string, unknown> }

/** Parses every satpad_vault event out of transaction logs (Anchor `Program data:` lines). */
export function parseVaultEvents(logs: string[]): VaultEvent[] {
  const out: VaultEvent[] = [];
  for (const e of parser.parseLogs(logs)) out.push({ name: e.name, data: e.data as Record<string, unknown> });
  return out;
}

// ---------- builders ----------

export interface InitializeParams {
  payer: PublicKey; admin: PublicKey; treasury: PublicKey; buybackWallet: PublicKey; rewardsWallet: PublicKey; lpWallet: PublicKey;
  split: FeeSplitBps; lpDrawMax: bigint; lpDrawIntervalSecs: bigint; creatorFeeBps: number; launchFeeLamports: bigint; quoteMint?: PublicKey;
}
export function buildInitialize(p: InitializeParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["initialize"]!({
    admin: p.admin, treasury: p.treasury, buybackWallet: p.buybackWallet, rewardsWallet: p.rewardsWallet, lpWallet: p.lpWallet,
    split: { liquidityBps: p.split.liquidityBps, buybackBps: p.split.buybackBps, operatorBps: p.split.operatorBps, deployerBps: p.split.deployerBps },
    lpDrawMax: bn(p.lpDrawMax), lpDrawInterval: bn(p.lpDrawIntervalSecs), creatorFeeBps: p.creatorFeeBps, launchFeeLamports: bn(p.launchFeeLamports),
  }).accounts({ payer: p.payer, config: configPda()[0], quoteMint, lpPot: lpPotPda()[0], quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM, systemProgram: SYSTEM_PROGRAM_ID }).instruction();
}

export type PayeeChoice = { kind: "me" } | { kind: "wallet"; wallet: PublicKey } | { kind: "holders" };
const payeeArg = (c: PayeeChoice) => (c.kind === "me" ? { me: {} } : c.kind === "holders" ? { holders: {} } : { wallet: [c.wallet] });

export interface DeclareCoinParams { user: PublicKey; mint: PublicKey; treasury: PublicKey; payee: PayeeChoice; treasuryOnly?: boolean; quoteMint?: PublicKey }
/** Must be in the same transaction as pump.fun `create_v2`, after it; signed by `user` and the mint keypair. */
export function buildDeclareCoin(p: DeclareCoinParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["declareCoin"]!(payeeArg(p.payee), p.treasuryOnly ?? false).accounts({
    user: p.user, mint: p.mint, config: configPda()[0], treasury: p.treasury, bondingCurve: bondingCurvePda(p.mint),
    coin: coinPda(p.mint)[0], coinFee: coinFeePda(p.mint)[0], coinFeeAta: ata(coinFeePda(p.mint)[0], quoteMint),
    payeePot: payeePotPda(p.mint)[0], rewardsPot: rewardsPotPda(p.mint)[0], quoteMint,
    quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYSTEM_PROGRAM_ID,
  }).instruction();
}

export interface SettleParams { mint: PublicKey; buybackWallet: PublicKey; treasury: PublicKey; quoteMint?: PublicKey }
export function buildSettle(p: SettleParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["settle"]!().accounts({
    config: configPda()[0], mint: p.mint, coin: coinPda(p.mint)[0], coinFee: coinFeePda(p.mint)[0], coinFeeAta: ata(coinFeePda(p.mint)[0], quoteMint),
    lpPot: lpPotPda()[0], buybackAta: ata(p.buybackWallet, quoteMint), treasuryAta: ata(p.treasury, quoteMint),
    payeePot: payeePotPda(p.mint)[0], rewardsPot: rewardsPotPda(p.mint)[0], quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
  }).instruction();
}

export interface PayPayeeParams { mint: PublicKey; payee: PublicKey; quoteMint?: PublicKey }
export function buildPayPayee(p: PayPayeeParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["payPayee"]!().accounts({
    config: configPda()[0], mint: p.mint, coin: coinPda(p.mint)[0], payeePot: payeePotPda(p.mint)[0], payeeAta: ata(p.payee, quoteMint), quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
  }).instruction();
}

export interface ChangePayeeParams { mint: PublicKey; payee: PublicKey; quoteMint?: PublicKey }
const changePayeeAccounts = (p: ChangePayeeParams) => {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return { payee: p.payee, config: configPda()[0], mint: p.mint, coin: coinPda(p.mint)[0], payeePot: payeePotPda(p.mint)[0], payeeAta: ata(p.payee, quoteMint), quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM };
};
export function buildRedirectPayee(p: ChangePayeeParams & { newPayee: PublicKey }): Promise<TransactionInstruction> {
  return program.methods["redirectPayee"]!(p.newPayee).accounts(changePayeeAccounts(p)).instruction();
}
export function buildSetHolderRewards(p: ChangePayeeParams): Promise<TransactionInstruction> {
  return program.methods["setHolderRewards"]!().accounts(changePayeeAccounts(p)).instruction();
}

export interface ReleaseRewardsParams { mint: PublicKey; rewardsWallet: PublicKey; runIndex: bigint; snapshotSha256: Uint8Array; quoteMint?: PublicKey }
export function buildReleaseRewards(p: ReleaseRewardsParams): Promise<TransactionInstruction> {
  if (p.snapshotSha256.length !== 32) throw new RangeError("snapshotSha256 must be 32 bytes");
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["releaseRewards"]!(Array.from(p.snapshotSha256)).accounts({
    rewardsWallet: p.rewardsWallet, config: configPda()[0], mint: p.mint, coin: coinPda(p.mint)[0], rewardsRun: rewardsRunPda(p.mint, p.runIndex)[0],
    rewardsPot: rewardsPotPda(p.mint)[0], rewardsAta: ata(p.rewardsWallet, quoteMint), quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM, systemProgram: SYSTEM_PROGRAM_ID,
  }).instruction();
}

export interface DrawLpParams { lpWallet: PublicKey; amount: bigint; quoteMint?: PublicKey }
export function buildDrawLp(p: DrawLpParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["drawLp"]!(bn(p.amount)).accounts({
    lpWallet: p.lpWallet, config: configPda()[0], lpPot: lpPotPda()[0], lpAta: ata(p.lpWallet, quoteMint), quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
  }).instruction();
}

const adminAccounts = (admin: PublicKey) => ({ admin, config: configPda()[0] });
export function buildSetSplit(admin: PublicKey, s: FeeSplitBps): Promise<TransactionInstruction> {
  return program.methods["setSplit"]!({ liquidityBps: s.liquidityBps, buybackBps: s.buybackBps, operatorBps: s.operatorBps, deployerBps: s.deployerBps }).accounts(adminAccounts(admin)).instruction();
}
export function buildSetWallets(admin: PublicKey, w: { treasury?: PublicKey; buybackWallet?: PublicKey; rewardsWallet?: PublicKey }): Promise<TransactionInstruction> {
  return program.methods["setWallets"]!(w.treasury ?? null, w.buybackWallet ?? null, w.rewardsWallet ?? null).accounts(adminAccounts(admin)).instruction();
}
/** D21: admin-only, write-once registration of the $SATPAD mint, PumpSwap pool and LP mint. */
export function buildSetSatpad(admin: PublicKey, s: { satpadMint: PublicKey; satpadPool: PublicKey; satpadLpMint: PublicKey }): Promise<TransactionInstruction> {
  return program.methods["setSatpad"]!(s.satpadMint, s.satpadPool, s.satpadLpMint).accounts(adminAccounts(admin)).instruction();
}
export function buildSetPause(admin: PublicKey, paused: boolean): Promise<TransactionInstruction> {
  return program.methods["setPause"]!(paused).accounts(adminAccounts(admin)).instruction();
}
export function buildSetCoinPause(admin: PublicKey, mint: PublicKey, paused: boolean): Promise<TransactionInstruction> {
  return program.methods["setCoinPause"]!(paused).accounts({ ...adminAccounts(admin), mint, coin: coinPda(mint)[0] }).instruction();
}
export interface RecoverParams { admin: PublicKey; mint: PublicKey; recoveryAddress: PublicKey; quoteMint?: PublicKey }
/** `recoveryAddress` must equal the program's compiled `RECOVERY_ADDRESS`; the program refuses anything else. */
export function buildRecover(p: RecoverParams): Promise<TransactionInstruction> {
  const quoteMint = p.quoteMint ?? BTC_QUOTE_MINT;
  return program.methods["recover"]!().accounts({
    ...adminAccounts(p.admin), mint: p.mint, coin: coinPda(p.mint)[0], coinFee: coinFeePda(p.mint)[0], coinFeeAta: ata(coinFeePda(p.mint)[0], quoteMint),
    recoveryAta: ata(p.recoveryAddress, quoteMint), quoteMint, quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
  }).instruction();
}
export interface SetLpParams { authority: PublicKey; lpWallet?: PublicKey; lpDrawMax?: bigint; lpDrawIntervalSecs?: bigint; programId?: PublicKey }
/** Signed by the program's upgrade authority (the Squads vault on mainnet). */
export function buildSetLp(p: SetLpParams): Promise<TransactionInstruction> {
  const programId = p.programId ?? SATPAD_VAULT_PROGRAM_ID;
  return program.methods["setLp"]!(p.lpWallet ?? null, p.lpDrawMax === undefined ? null : bn(p.lpDrawMax), p.lpDrawIntervalSecs === undefined ? null : bn(p.lpDrawIntervalSecs)).accounts({
    authority: p.authority, config: configPda()[0], program: programId, programData: vaultProgramData(programId),
  }).instruction();
}

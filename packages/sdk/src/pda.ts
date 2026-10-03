// satpad_vault PDAs. Seeds are the ones in SPEC.md "satpad_vault program → Accounts (PDAs)"; the Anchor program
// (programs/satpad_vault, milestone 2) must use byte-identical seeds, and its bankrun tests import these helpers
// so the two can never drift.
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM } from "./quoteMints";

/**
 * Dev program id (keypair in keys/satpad_vault-dev.json, gitignored). Mainnet deploys with a fresh keypair whose
 * upgrade authority is handed to the Squads vault immediately; override via `SATPAD_VAULT_PROGRAM_ID`.
 */
export const SATPAD_VAULT_PROGRAM_ID = new PublicKey(
  process.env["SATPAD_VAULT_PROGRAM_ID"] ?? "52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93",
);

export const SEED_CONFIG = Buffer.from("config");
export const SEED_COIN_FEE = Buffer.from("coin_fee");
export const SEED_COIN = Buffer.from("coin");
export const SEED_PAYEE_POT = Buffer.from("payee_pot");
export const SEED_REWARDS_POT = Buffer.from("rewards_pot");
export const SEED_LP_POT = Buffer.from("lp_pot");
export const SEED_REWARDS_RUN = Buffer.from("rewards_run");

export type Pda = readonly [address: PublicKey, bump: number];

const find = (seeds: Buffer[], programId: PublicKey): Pda => PublicKey.findProgramAddressSync(seeds, programId);

/** `["config"]` — singleton: admin, wallets, quote mint + decimals, split bps, LP limits, creator_fee_bps, pause. */
export const configPda = (programId = SATPAD_VAULT_PROGRAM_ID): Pda => find([SEED_CONFIG], programId);

/**
 * `["coin_fee", mint]` — the pump.fun `creator` for this coin (VERIFIED V4 / DECISIONS D4). Creator fees are
 * collected into this PDA's wBTC ATA (see {@link coinFeeAta}) and split by `settle`.
 */
export const coinFeePda = (mint: PublicKey, programId = SATPAD_VAULT_PROGRAM_ID): Pda =>
  find([SEED_COIN_FEE, mint.toBuffer()], programId);

/** `["coin", mint]` — mint, deployer, payee, payee_mode, paused, created_at, declared. */
export const coinPda = (mint: PublicKey, programId = SATPAD_VAULT_PROGRAM_ID): Pda =>
  find([SEED_COIN, mint.toBuffer()], programId);

/** `["payee_pot", mint]` — token account; deployer share waiting for `pay_payee`. */
export const payeePotPda = (mint: PublicKey, programId = SATPAD_VAULT_PROGRAM_ID): Pda =>
  find([SEED_PAYEE_POT, mint.toBuffer()], programId);

/** `["rewards_pot", mint]` — token account; deployer share when payee_mode is Holders. */
export const rewardsPotPda = (mint: PublicKey, programId = SATPAD_VAULT_PROGRAM_ID): Pda =>
  find([SEED_REWARDS_POT, mint.toBuffer()], programId);

/** `["lp_pot"]` — singleton token account; liquidity share from every coin, drained only by `draw_lp`. */
export const lpPotPda = (programId = SATPAD_VAULT_PROGRAM_ID): Pda => find([SEED_LP_POT], programId);

/** `["rewards_run", mint, run_index as u64 LE]` — snapshot hash, slot, amount, timestamp for one holder-rewards run. */
export const rewardsRunPda = (mint: PublicKey, runIndex: bigint, programId = SATPAD_VAULT_PROGRAM_ID): Pda => {
  if (runIndex < 0n || runIndex > 0xffff_ffff_ffff_ffffn) throw new RangeError("runIndex must fit in u64");
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(runIndex);
  return find([SEED_REWARDS_RUN, mint.toBuffer(), idx], programId);
};

/**
 * The wBTC ATA owned by the `CoinFee` PDA. pump.fun's `collect_creator_fee_v2` / PumpSwap `collect_coin_creator_fee`
 * pay into `ATA(creator, quote_mint)`, which must already exist (VERIFIED V4). Owner is off-curve, hence `true`.
 */
export const coinFeeAta = (mint: PublicKey, programId = SATPAD_VAULT_PROGRAM_ID): PublicKey =>
  getAssociatedTokenAddressSync(BTC_QUOTE_MINT, coinFeePda(mint, programId)[0], true, BTC_QUOTE_TOKEN_PROGRAM);

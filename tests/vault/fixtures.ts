// Shared setup for vault tests: an initialized Config and a fake pump.fun BondingCurve injected into LiteSVM.
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { PUMP_PROGRAM_ID, coinFeePda, configPda, lpPotPda } from "@satpad/sdk";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { VaultSvm } from "./harness";

export const LAUNCH_FEE = 10_000_000n;

export interface Wallets { admin: Keypair; treasury: Keypair; buyback: Keypair; rewards: Keypair; lp: Keypair }

export function wallets(): Wallets {
  return { admin: Keypair.generate(), treasury: Keypair.generate(), buyback: Keypair.generate(), rewards: Keypair.generate(), lp: Keypair.generate() };
}

/** Initializes Config with the SPEC default split, fee 100 bps, LP 500k/300s. Returns the quote mint. */
export async function initialized(v: VaultSvm, w: Wallets, overrides: Record<string, unknown> = {}): Promise<PublicKey> {
  const quoteMint = v.createMint(8);
  const ix = await v.program.methods["initialize"]!({
    admin: w.admin.publicKey, treasury: w.treasury.publicKey, buybackWallet: w.buyback.publicKey, rewardsWallet: w.rewards.publicKey, lpWallet: w.lp.publicKey,
    split: { liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4000 },
    lpDrawMax: new BN(500_000), lpDrawInterval: new BN(300), creatorFeeBps: 100, launchFeeLamports: new BN(LAUNCH_FEE.toString()),
    ...overrides,
  }).accounts({ payer: v.payer.publicKey, config: configPda()[0], quoteMint, lpPot: lpPotPda()[0], quoteTokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction();
  v.send([ix], [v.payer]);
  for (const k of Object.values(w)) v.airdrop(k.publicKey, 10_000_000_000n);
  return quoteMint;
}

export interface CurveFields {
  creator?: PublicKey; quoteMint?: PublicKey; creatorFeeBps?: bigint; isHolderReward?: boolean; isMayhemMode?: boolean; complete?: boolean;
  virtualQuoteReserves?: bigint; realQuoteReserves?: bigint;
}

/** Writes a 125-byte pump.fun BondingCurve for `mint` at pump's PDA, owned by the pump program. Layout: VERIFIED V3. */
export function injectCurve(v: VaultSvm, mint: PublicKey, f: CurveFields = {}): PublicKey {
  const buf = Buffer.alloc(125);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(buf, 0);
  buf.writeBigUInt64LE(1_072_999_000_000_000n, 8); // virtual_token_reserves
  buf.writeBigUInt64LE(f.virtualQuoteReserves ?? 5_082_192n, 16); // virtual_quote_reserves (wBTC initial)
  buf.writeBigUInt64LE(793_099_000_000_000n, 24); // real_token_reserves
  buf.writeBigUInt64LE(f.realQuoteReserves ?? 0n, 32); // real_quote_reserves
  buf.writeBigUInt64LE(1_000_000_000_000_000n, 40); // token_total_supply
  buf[48] = f.complete ? 1 : 0;
  (f.creator ?? coinFeePda(mint)[0]).toBuffer().copy(buf, 49);
  buf[81] = f.isMayhemMode ? 1 : 0;
  buf[82] = 0; // is_cashback_coin
  (f.quoteMint ?? PublicKey.default).toBuffer().copy(buf, 83);
  buf.writeBigUInt64LE(f.creatorFeeBps ?? 100n, 115);
  buf[123] = 0; // can_edit_creator_fee
  buf[124] = f.isHolderReward ? 1 : 0;
  const pda = bondingCurvePda(mint);
  v.setAccount(pda, PUMP_PROGRAM_ID, buf);
  return pda;
}

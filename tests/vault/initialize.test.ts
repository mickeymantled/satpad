import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import BN from "bn.js";
import { DEFAULT_SPLIT, configPda, lpPotPda } from "@satpad/sdk";
import { VaultSvm } from "./harness";

const ARGS = {
  admin: Keypair.generate().publicKey,
  treasury: Keypair.generate().publicKey,
  buybackWallet: Keypair.generate().publicKey,
  rewardsWallet: Keypair.generate().publicKey,
  lpWallet: Keypair.generate().publicKey,
  split: { liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4000 },
  lpDrawMax: new BN(500_000),
  lpDrawInterval: new BN(300),
  creatorFeeBps: 100,
  launchFeeLamports: new BN(10_000_000),
};

describe("initialize", () => {
  let v: VaultSvm;
  let quoteMint: PublicKey;
  beforeEach(() => {
    v = new VaultSvm();
    quoteMint = v.createMint(8);
  });

  const initIx = (args: Partial<typeof ARGS> = {}, mint = quoteMint) =>
    v.program.methods["initialize"]!({ ...ARGS, ...args }).accounts({
      payer: v.payer.publicKey, config: configPda()[0], quoteMint: mint, lpPot: lpPotPda()[0],
      quoteTokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction();

  it("creates Config with every field and an LpPot owned by Config", async () => {
    v.send([await initIx()], [v.payer]);
    const c = v.decode<Record<string, unknown>>("Config", configPda()[0]);
    expect((c["admin"] as PublicKey).equals(ARGS.admin)).toBe(true);
    expect((c["treasury"] as PublicKey).equals(ARGS.treasury)).toBe(true);
    expect((c["buyback_wallet"] as PublicKey).equals(ARGS.buybackWallet)).toBe(true);
    expect((c["rewards_wallet"] as PublicKey).equals(ARGS.rewardsWallet)).toBe(true);
    expect((c["lp_wallet"] as PublicKey).equals(ARGS.lpWallet)).toBe(true);
    expect((c["quote_mint"] as PublicKey).equals(quoteMint)).toBe(true);
    expect(c["quote_decimals"]).toBe(8); // read from the mint, not assumed
    expect(c["split"]).toEqual({ liquidity_bps: 2500, buyback_bps: 2500, operator_bps: 1000, deployer_bps: 4000 });
    expect(DEFAULT_SPLIT).toEqual({ liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4000 }); // SDK default == program init args
    expect((c["lp_draw_max"] as BN).toNumber()).toBe(500_000);
    expect((c["lp_draw_interval"] as BN).toNumber()).toBe(300);
    expect((c["last_lp_draw_ts"] as BN).toNumber()).toBe(0);
    expect(c["creator_fee_bps"]).toBe(100);
    expect(c["paused"]).toBe(false);
    expect((c["launch_fee_lamports"] as BN).toNumber()).toBe(10_000_000);
    expect((c["satpad_mint"] as PublicKey).equals(PublicKey.default)).toBe(true);
    expect(c["bump"]).toBe(configPda()[1]);
    expect(c["lp_pot_bump"]).toBe(lpPotPda()[1]);

    const pot = unpackAccount(lpPotPda()[0], { data: v.accountData(lpPotPda()[0])!, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 0 } as never, TOKEN_PROGRAM_ID);
    expect(pot.mint.equals(quoteMint)).toBe(true);
    expect(pot.owner.equals(configPda()[0])).toBe(true);
    expect(pot.amount).toBe(0n);
  });

  it("reads decimals from whatever mint is passed", async () => {
    const six = v.createMint(6);
    v.send([await initIx({}, six)], [v.payer]);
    expect(v.decode<{ quote_decimals: number }>("Config", configPda()[0]).quote_decimals).toBe(6);
  });

  it("runs only once", async () => {
    v.send([await initIx()], [v.payer]);
    const again = await initIx();
    expect(() => v.send([again], [v.payer])).toThrow();
  });

  it("refuses splits outside the program bounds, exactly at the edges", async () => {
    v.expectFail([await initIx({ split: { liquidityBps: 2499, buybackBps: 2501, operatorBps: 1000, deployerBps: 4000 } })], [v.payer], "LiquidityTooLow");
    v.expectFail([await initIx({ split: { liquidityBps: 2500, buybackBps: 2499, operatorBps: 2001, deployerBps: 3000 } })], [v.payer], "OperatorTooHigh");
    v.expectFail([await initIx({ split: { liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 4001 } })], [v.payer], "SplitSum");
    v.expectFail([await initIx({ split: { liquidityBps: 2500, buybackBps: 2500, operatorBps: 1000, deployerBps: 3999 } })], [v.payer], "SplitSum");
    // edges that must pass
    v.send([await initIx({ split: { liquidityBps: 2500, buybackBps: 2500, operatorBps: 2000, deployerBps: 3000 } })], [v.payer]);
  });

  it("refuses LP params outside the caps", async () => {
    v.expectFail([await initIx({ lpDrawMax: new BN(500_001) })], [v.payer], "LpDrawMaxTooHigh");
    v.expectFail([await initIx({ lpDrawInterval: new BN(299) })], [v.payer], "LpDrawIntervalTooShort");
  });

  it("refuses creator fee bps outside 1..=100", async () => {
    v.expectFail([await initIx({ creatorFeeBps: 0 })], [v.payer], "CreatorFeeOutOfRange");
    v.expectFail([await initIx({ creatorFeeBps: 101 })], [v.payer], "CreatorFeeOutOfRange");
    v.send([await initIx({ creatorFeeBps: 1 })], [v.payer]);
  });
});

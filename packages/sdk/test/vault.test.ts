import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  DEFAULT_SPLIT, SATPAD_VAULT_PROGRAM_ID, VAULT_IDL, buildDeclareCoin, buildDrawLp, buildInitialize, buildPayPayee, buildRecover, buildRedirectPayee,
  buildReleaseRewards, buildSetCoinPause, buildSetHolderRewards, buildSetLp, buildSetPause, buildSetSplit, buildSetWallets, buildSettle,
  coinPda, decodeCoin, decodeConfig, decodeRewardsRun, parseVaultEvents, rewardsRunPda, vaultProgramData,
} from "../src";

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean }[] };
const idl = VAULT_IDL as unknown as { instructions: IdlIx[]; events: { name: string; discriminator: number[] }[] };
const ixDef = (name: string): IdlIx => idl.instructions.find((i) => i.name === name)!;
const coder = new BorshCoder(VAULT_IDL);

function expectMatchesIdl(ix: TransactionInstruction, name: string): IdlIx {
  const def = ixDef(name);
  expect(ix.programId.equals(SATPAD_VAULT_PROGRAM_ID)).toBe(true);
  expect(Array.from(ix.data.subarray(0, 8))).toEqual(def.discriminator);
  expect(ix.keys.length).toBe(def.accounts.length);
  def.accounts.forEach((a, i) => expect({ n: a.name, w: ix.keys[i]!.isWritable, s: ix.keys[i]!.isSigner }).toEqual({ n: a.name, w: !!a.writable, s: !!a.signer }));
  return def;
}
const k = () => Keypair.generate().publicKey;
const mint = k(), admin = k(), treasury = k(), buyback = k(), rewards = k(), lp = k(), user = k();

describe("vault builders match the IDL", () => {
  it("initialize", async () => {
    const ix = await buildInitialize({ payer: user, admin, treasury, buybackWallet: buyback, rewardsWallet: rewards, lpWallet: lp, split: DEFAULT_SPLIT, lpDrawMax: 500_000n, lpDrawIntervalSecs: 300n, creatorFeeBps: 100, launchFeeLamports: 10_000_000n });
    expectMatchesIdl(ix, "initialize");
    const args = coder.instruction.decode(ix.data) as { data: Record<string, unknown> };
    const a = (args.data as { args: Record<string, unknown> }).args;
    expect((a["lp_draw_max"] as BN).toNumber()).toBe(500_000);
    expect(a["creator_fee_bps"]).toBe(100);
  });
  it("declare_coin with each payee choice", async () => {
    for (const payee of [{ kind: "me" }, { kind: "wallet", wallet: k() }, { kind: "holders" }] as const) {
      const ix = await buildDeclareCoin({ user, mint, treasury, payee, treasuryOnly: payee.kind === "holders" });
      const def = expectMatchesIdl(ix, "declare_coin");
      expect(ix.keys[def.accounts.findIndex((a) => a.name === "coin")]!.pubkey.equals(coinPda(mint)[0])).toBe(true);
      expect(ix.keys[def.accounts.findIndex((a) => a.name === "mint")]!.isSigner).toBe(true);
    }
  });
  it("settle, pay_payee, redirect_payee, set_holder_rewards", async () => {
    expectMatchesIdl(await buildSettle({ mint, buybackWallet: buyback, treasury }), "settle");
    expectMatchesIdl(await buildPayPayee({ mint, payee: user }), "pay_payee");
    expectMatchesIdl(await buildRedirectPayee({ mint, payee: user, newPayee: k() }), "redirect_payee");
    expectMatchesIdl(await buildSetHolderRewards({ mint, payee: user }), "set_holder_rewards");
  });
  it("release_rewards derives the RewardsRun PDA from runIndex and requires a 32-byte hash", async () => {
    const h = new Uint8Array(32).fill(7);
    const ix = await buildReleaseRewards({ mint, rewardsWallet: rewards, runIndex: 3n, snapshotSha256: h });
    const def = expectMatchesIdl(ix, "release_rewards");
    expect(ix.keys[def.accounts.findIndex((a) => a.name === "rewards_run")]!.pubkey.equals(rewardsRunPda(mint, 3n)[0])).toBe(true);
    expect(Array.from(ix.data.subarray(8))).toEqual(Array.from(h));
    expect(() => buildReleaseRewards({ mint, rewardsWallet: rewards, runIndex: 0n, snapshotSha256: new Uint8Array(31) })).toThrow(RangeError);
  });
  it("draw_lp encodes the amount", async () => {
    const ix = await buildDrawLp({ lpWallet: lp, amount: 123_456n });
    expectMatchesIdl(ix, "draw_lp");
    expect(ix.data.readBigUInt64LE(8)).toBe(123_456n);
  });
  it("admin and upgrade-authority builders", async () => {
    expectMatchesIdl(await buildSetSplit(admin, DEFAULT_SPLIT), "set_split");
    expectMatchesIdl(await buildSetWallets(admin, { treasury: k() }), "set_wallets");
    expectMatchesIdl(await buildSetPause(admin, true), "set_pause");
    expectMatchesIdl(await buildSetCoinPause(admin, mint, true), "set_coin_pause");
    expectMatchesIdl(await buildRecover({ admin, mint, recoveryAddress: k() }), "recover");
    const ix = await buildSetLp({ authority: admin, lpDrawMax: 1n });
    const def = expectMatchesIdl(ix, "set_lp");
    expect(ix.keys[def.accounts.findIndex((a) => a.name === "program_data")]!.pubkey.equals(vaultProgramData())).toBe(true);
    expect(ix.keys[def.accounts.findIndex((a) => a.name === "program")]!.pubkey.equals(SATPAD_VAULT_PROGRAM_ID)).toBe(true);
  });
});

describe("vault decoders", () => {
  it("Config round-trips through the coder with bigint amounts and camelCase names", async () => {
    const raw = {
      admin, treasury, buyback_wallet: buyback, rewards_wallet: rewards, lp_wallet: lp, quote_mint: mint, quote_decimals: 8,
      split: { liquidity_bps: 2500, buyback_bps: 2500, operator_bps: 1000, deployer_bps: 4000 }, lp_draw_max: new BN(500_000), lp_draw_interval: new BN(300),
      last_lp_draw_ts: new BN(0), creator_fee_bps: 100, paused: false, launch_fee_lamports: new BN("10000000"), satpad_mint: PublicKey.default,
      satpad_pool: PublicKey.default, satpad_lp_mint: PublicKey.default, bump: 254, lp_pot_bump: 253,
    };
    const c = decodeConfig(await coder.accounts.encode("Config", raw));
    expect(c.admin.equals(admin)).toBe(true);
    expect(c.split).toEqual(DEFAULT_SPLIT);
    expect(c.lpDrawMax).toBe(500_000n);
    expect(c.launchFeeLamports).toBe(10_000_000n);
    expect(c.quoteDecimals).toBe(8);
  });
  it("Coin maps the PayeeMode enum", async () => {
    const base = { mint, deployer: user, payee: user, paused: false, created_at: new BN(1_750_000_000), declared: true, treasury_only: false, last_rewards_run_ts: new BN(0), rewards_run_count: new BN(2), bump: 1, coin_fee_bump: 2, payee_pot_bump: 3, rewards_pot_bump: 4 };
    expect(decodeCoin(await coder.accounts.encode("Coin", { ...base, payee_mode: { Wallet: {} } })).payeeMode).toBe("wallet");
    const h = decodeCoin(await coder.accounts.encode("Coin", { ...base, payee_mode: { Holders: {} } }));
    expect(h.payeeMode).toBe("holders");
    expect(h.rewardsRunCount).toBe(2n);
    expect(h.createdAt).toBe(1_750_000_000n);
  });
  it("RewardsRun keeps the 32-byte hash", async () => {
    const hash = Array.from({ length: 32 }, (_, i) => i);
    const r = decodeRewardsRun(await coder.accounts.encode("RewardsRun", { mint, run_index: new BN(5), snapshot_sha256: hash, slot: new BN(99), amount_released: new BN(1234), timestamp: new BN(7), bump: 1 }));
    expect(Array.from(r.snapshotSha256)).toEqual(hash);
    expect(r.runIndex).toBe(5n);
    expect(r.amountReleased).toBe(1234n);
  });
});

describe("event parser", () => {
  it("decodes a Settled event from a Program data log line", () => {
    const def = idl.events.find((e) => e.name === "Settled")!;
    const body = coder.types.encode("Settled", {
      mint, amount: new BN(10_000), liquidity: new BN(2500), buyback: new BN(2500), operator: new BN(1000), deployer: new BN(4000), deployer_destination: user,
      split: { liquidity_bps: 2500, buyback_bps: 2500, operator_bps: 1000, deployer_bps: 4000 },
    });
    const line = `Program data: ${Buffer.concat([Buffer.from(def.discriminator), body]).toString("base64")}`;
    const logs = [`Program ${SATPAD_VAULT_PROGRAM_ID.toBase58()} invoke [1]`, "Program log: Instruction: Settle", line, `Program ${SATPAD_VAULT_PROGRAM_ID.toBase58()} success`];
    const events = parseVaultEvents(logs);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("Settled");
    expect((events[0]!.data["liquidity"] as BN).toNumber()).toBe(2500);
    expect((events[0]!.data["mint"] as PublicKey).equals(mint)).toBe(true);
  });
  it("ignores logs from other programs", () => {
    expect(parseVaultEvents(["Program 11111111111111111111111111111111 invoke [1]", "Program data: AAAA", "Program 11111111111111111111111111111111 success"])).toEqual([]);
  });
});

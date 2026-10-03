import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { bondingCurvePda, creatorVaultPda } from "@pump-fun/pump-sdk";
import {
  COIN_TOKEN_PROGRAM,
  DEFAULT_BUYBACK_RECIPIENT_INDEX,
  PUMP_BUYBACK_FEE_RECIPIENTS,
  buildBuyV2,
  buildCollectCreatorFeeV2,
  buildCreateV2,
  buildSellV2,
  coinAccounts,
  defaultFeeRecipients,
} from "../src/pump";
import { BTC_QUOTE_MINT, MAX_CREATOR_FEE_BPS, PUMP_PROGRAM_ID, PUMP_QUOTE_CONTROL } from "../src/quoteMints";
import { coinFeePda } from "../src/pda";

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean }[] };
const idl = JSON.parse(readFileSync(new URL("../../../idl-ref/pump.json", import.meta.url), "utf8")) as { instructions: IdlIx[] };
const ixDef = (name: string): IdlIx => idl.instructions.find((i) => i.name === name)!;

const user = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const creator = coinFeePda(mint)[0];
const recipients = { feeRecipient: Keypair.generate().publicKey, buybackFeeRecipient: PUMP_BUYBACK_FEE_RECIPIENTS[1]! };

/** Assert an instruction's named accounts match the IDL in order, writability and signer flags. */
function expectMatchesIdl(ix: TransactionInstruction, name: string) {
  const def = ixDef(name);
  expect(ix.programId.equals(PUMP_PROGRAM_ID)).toBe(true);
  expect(Array.from(ix.data.subarray(0, 8))).toEqual(def.discriminator);
  expect(ix.keys.length).toBeGreaterThanOrEqual(def.accounts.length);
  def.accounts.forEach((a, i) => {
    const k = ix.keys[i]!;
    expect({ name: a.name, w: k.isWritable, s: k.isSigner }).toEqual({ name: a.name, w: !!a.writable, s: !!a.signer });
  });
  return def;
}
const keyAt = (ix: TransactionInstruction, name: string, def: IdlIx) => ix.keys[def.accounts.findIndex((a) => a.name === name)]!;

describe("buildCreateV2", () => {
  it("matches the create_v2 IDL and pins the wBTC quote in remaining accounts", async () => {
    const ix = await buildCreateV2({ mint, name: "Satpad Test", symbol: "SPT", uri: "https://x/m.json", creator, user });
    const def = expectMatchesIdl(ix, "create_v2");
    expect(keyAt(ix, "mint", def).pubkey.equals(mint)).toBe(true);
    expect(keyAt(ix, "mint", def).isSigner).toBe(true);
    expect(keyAt(ix, "user", def).isSigner).toBe(true);
    expect(keyAt(ix, "token_program", def).pubkey.equals(COIN_TOKEN_PROGRAM)).toBe(true);
    // remaining accounts: quote_mint, associated_quote_bonding_curve, quote_token_program, quote-control
    const rem = ix.keys.slice(def.accounts.length).map((k) => k.pubkey.toBase58());
    expect(rem[0]).toBe(BTC_QUOTE_MINT.toBase58());
    expect(rem[1]).toBe(getAssociatedTokenAddressSync(BTC_QUOTE_MINT, bondingCurvePda(mint), true, TOKEN_PROGRAM_ID).toBase58());
    expect(rem[2]).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(rem).toContain(PUMP_QUOTE_CONTROL.toBase58());
    // creator is an arg, not an account, and never a signer
    expect(ix.keys.some((k) => k.pubkey.equals(creator))).toBe(false);
    expect(ix.data.includes(creator.toBuffer())).toBe(true);
  });

  it("encodes creator_fee_bps=100 by default and rejects out-of-range or bad inputs", async () => {
    const ix = await buildCreateV2({ mint, name: "A", symbol: "A", uri: "u", creator, user });
    // After `creator` the args are: is_mayhem_mode (bool), is_cashback_enabled (OptionBool = bare bool),
    // creator_fee_bps (OptionU64 = bare u64, 0 means unset), is_holder_reward (OptionBool). VERIFIED V3.
    const tail = ix.data.subarray(ix.data.indexOf(creator.toBuffer()) + 32);
    expect(tail.length).toBe(11);
    expect(tail[0]).toBe(0); // mayhem off
    expect(tail[1]).toBe(0); // cashback off (deprecated, must be false)
    expect(tail.readBigUInt64LE(2)).toBe(100n);
    expect(tail[10]).toBe(0); // holder reward off: creator stays our PDA
    await expect(buildCreateV2({ mint, name: "A", symbol: "A", uri: "u", creator, user, creatorFeeBps: MAX_CREATOR_FEE_BPS + 1 })).rejects.toThrow(RangeError);
    await expect(buildCreateV2({ mint, name: "A", symbol: "A", uri: "u", creator, user, creatorFeeBps: 0 })).rejects.toThrow(RangeError);
    await expect(buildCreateV2({ mint, name: "x".repeat(33), symbol: "A", uri: "u", creator, user })).rejects.toThrow(/32 bytes/);
    await expect(buildCreateV2({ mint, name: "A", symbol: "A", uri: "u", creator: PublicKey.default, user })).rejects.toThrow(/default/);
  });
});

describe("buildBuyV2 / buildSellV2", () => {
  it("buy matches the buy_v2 IDL with wBTC quote accounts and the pinned recipients", async () => {
    const [ata, ix] = await buildBuyV2({ user, mint, creator, recipients, tokenAmount: 1_000_000_000n, maxQuoteIn: 20_000n });
    expect(ata!.programId.toBase58()).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const def = expectMatchesIdl(ix!, "buy_v2");
    expect(keyAt(ix!, "quote_mint", def).pubkey.equals(BTC_QUOTE_MINT)).toBe(true);
    expect(keyAt(ix!, "quote_token_program", def).pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(keyAt(ix!, "base_token_program", def).pubkey.equals(COIN_TOKEN_PROGRAM)).toBe(true);
    expect(keyAt(ix!, "fee_recipient", def).pubkey.equals(recipients.feeRecipient)).toBe(true);
    expect(keyAt(ix!, "buyback_fee_recipient", def).pubkey.equals(recipients.buybackFeeRecipient)).toBe(true);
    expect(keyAt(ix!, "creator_vault", def).pubkey.equals(creatorVaultPda(creator))).toBe(true);
    expect(keyAt(ix!, "associated_quote_user", def).pubkey.equals(getAssociatedTokenAddressSync(BTC_QUOTE_MINT, user, false, TOKEN_PROGRAM_ID))).toBe(true);
    // args: amount u64 LE, max_sol_cost u64 LE
    expect(ix!.data.readBigUInt64LE(8)).toBe(1_000_000_000n);
    expect(ix!.data.readBigUInt64LE(16)).toBe(20_000n);
  });

  it("sell matches the sell_v2 IDL", async () => {
    const ix = await buildSellV2({ user, mint, creator, recipients, tokenAmount: 5n, minQuoteOut: 3n });
    const def = expectMatchesIdl(ix, "sell_v2");
    expect(keyAt(ix, "quote_mint", def).pubkey.equals(BTC_QUOTE_MINT)).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(5n);
    expect(ix.data.readBigUInt64LE(16)).toBe(3n);
  });
});

describe("buildCollectCreatorFeeV2", () => {
  it("matches the IDL, creator is not a signer, pays into the creator's wBTC ATA", async () => {
    const ix = await buildCollectCreatorFeeV2(creator);
    const def = expectMatchesIdl(ix, "collect_creator_fee_v2");
    expect(keyAt(ix, "creator", def).isSigner).toBe(false);
    expect(keyAt(ix, "creator_token_account", def).pubkey.equals(coinAccounts(mint, creator).creatorQuoteAta)).toBe(true);
    expect(keyAt(ix, "creator_vault_token_account", def).pubkey.equals(coinAccounts(mint, creator).creatorVaultQuoteAta)).toBe(true);
    expect(ix.keys.every((k) => !k.isSigner)).toBe(true);
  });
});

describe("fee recipients", () => {
  it("pinned buyback list equals pump-sdk 2.0.0's unexported CURRENT_FEE_RECIPIENTS_FOR_BUYBACK", () => {
    const req = createRequire(import.meta.url);
    const src = readFileSync(req.resolve("@pump-fun/pump-sdk"), "utf8");
    const m = /CURRENT_FEE_RECIPIENTS_FOR_BUYBACK = \[([^\]]+)\]/.exec(src)!;
    const fromSdk = [...m[1]!.matchAll(/"([1-9A-HJ-NP-Za-km-z]{32,44})"/g)].map((x) => x[1]);
    expect(PUMP_BUYBACK_FEE_RECIPIENTS.map((k) => k.toBase58())).toEqual(fromSdk);
  });
  it("defaultFeeRecipients is deterministic", () => {
    const fr = Keypair.generate().publicKey;
    const r = defaultFeeRecipients({ feeRecipient: fr });
    expect(r.feeRecipient.equals(fr)).toBe(true);
    expect(r.buybackFeeRecipient.equals(PUMP_BUYBACK_FEE_RECIPIENTS[DEFAULT_BUYBACK_RECIPIENT_INDEX]!)).toBe(true);
    expect(r.buybackFeeRecipient.toBase58()).toBe("9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7"); // cloned by scripts/local-fork.sh
  });
});

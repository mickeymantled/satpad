import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { PUMP_BUYBACK_FEE_RECIPIENTS, PUMP_GLOBAL, PUMP_PROGRAM_ID, SATPAD_VAULT_PROGRAM_ID, buildBuyV2, buildCreateV2, buildDeclareCoin, buildV0Transaction, coinFeePda, coinPda, configPda, staticAccounts } from "../src";

const feeRecipient = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
async function launchIxs(): Promise<{ ixs: TransactionInstruction[]; mint: PublicKey; user: PublicKey }> {
  const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey;
  const creator = coinFeePda(mint)[0];
  const ixs = [
    await buildCreateV2({ mint, name: "A", symbol: "A", uri: "u", creator, user }),
    await buildDeclareCoin({ user, mint, treasury, payee: { kind: "me" } }),
    ...(await buildBuyV2({ user, mint, creator, recipients: { feeRecipient, buybackFeeRecipient: PUMP_BUYBACK_FEE_RECIPIENTS[1]! }, tokenAmount: 1n, maxQuoteIn: 1n })),
  ];
  return { ixs, mint, user };
}

describe("launch lookup table", () => {
  it("staticAccounts keeps only accounts common to two launches and never per-mint, per-user or signer keys", async () => {
    const a = await launchIxs(), b = await launchIxs();
    const s = staticAccounts(a.ixs, b.ixs);
    const set = new Set(s.map((k) => k.toBase58()));
    expect(s.length).toBeGreaterThanOrEqual(15);
    for (const must of [PUMP_PROGRAM_ID, PUMP_GLOBAL, SATPAD_VAULT_PROGRAM_ID, configPda()[0], treasury, feeRecipient]) expect(set.has(must.toBase58()), must.toBase58()).toBe(true);
    for (const never of [a.mint, a.user, bondingCurvePda(a.mint), coinPda(a.mint)[0], coinFeePda(a.mint)[0], b.mint]) expect(set.has(never.toBase58())).toBe(false);
  });

  it("legacy launch exceeds 1232 bytes; v0 with the static table fits", async () => {
    const { ixs, user } = await launchIxs();
    const other = await launchIxs();
    const blockhash = Keypair.generate().publicKey.toBase58();
    expect(() => buildV0Transaction(user, blockhash, ixs, [])).toThrow(/1232/);
    const addresses = staticAccounts(ixs, other.ixs);
    const table = { key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses } };
    const tx = buildV0Transaction(user, blockhash, ixs, [table as never]);
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
    expect(tx.message.addressTableLookups).toHaveLength(1);
  });
});

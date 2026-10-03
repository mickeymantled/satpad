import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BTC_QUOTE_MINT, DEFAULT_SPLIT, splitFee } from "@satpad/sdk";
import { decodeTx, fromFixture, fromHeliusRaw, holderUpdates, type NormalizedTx } from "../src/decode";

const fixture = (name: string): NormalizedTx => fromFixture(JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8")));

describe("decodeTx on recorded fork transactions", () => {
  it("buy_v2 → one curve buy quoted in wBTC with reserves and creator fee", () => {
    const tx = fixture("buy_v2");
    const d = decodeTx(tx);
    expect(d.trades).toHaveLength(1);
    const t = d.trades[0]!;
    expect(t.side).toBe("buy");
    expect(t.venue).toBe("curve");
    expect(t.quoteMint).toBe(BTC_QUOTE_MINT.toBase58());
    expect(t.btcAmount).toBeGreaterThan(0n);
    expect(t.tokenAmount).toBeGreaterThan(0n);
    expect(t.creatorFeeBtc).toBeGreaterThanOrEqual(0n);
    expect(t.virtualQuoteReserves).toBeGreaterThan(5_082_192n);
    expect(t.slot).toBe(tx.slot);
    // the trader's post balance for the coin appears in holder updates
    const h = d.holders.find((x) => x.mint === t.mint && x.wallet === t.trader);
    expect(h?.balance).toBeGreaterThan(0n);
    expect(d.settles).toHaveLength(0);
  });

  it("sell_v2 → one curve sell", () => {
    const d = decodeTx(fixture("sell_v2"));
    expect(d.trades).toHaveLength(1);
    expect(d.trades[0]!.side).toBe("sell");
    expect(d.trades[0]!.btcAmount).toBeGreaterThan(0n);
  });

  it("settle → Settled with amounts that match the SDK split, and wBTC holder updates for the pots", () => {
    const d = decodeTx(fixture("settle"));
    expect(d.settles).toHaveLength(1);
    const s = d.settles[0]!;
    const exp = splitFee(s.amount, DEFAULT_SPLIT);
    expect({ liquidity: s.liquidity, buyback: s.buyback, operator: s.operator, deployer: s.deployer }).toEqual(exp);
    expect(s.liquidity + s.buyback + s.operator + s.deployer).toBe(s.amount);
    expect(d.trades).toHaveLength(0);
    expect(d.holders.some((h) => h.mint === BTC_QUOTE_MINT.toBase58())).toBe(true);
  });

  it("pay_payee → PayeePaid", () => {
    const d = decodeTx(fixture("pay_payee"));
    expect(d.payouts).toHaveLength(1);
    expect(d.payouts[0]!.amount).toBeGreaterThan(0n);
  });

  it("collect_creator_fee_v2 → CollectCreatorFeeEvent in wBTC", () => {
    const d = decodeTx(fixture("collect_creator_fee_v2"));
    expect(d.collects).toHaveLength(1);
    expect(d.collects[0]!.quoteMint).toBe(BTC_QUOTE_MINT.toBase58());
    expect(d.collects[0]!.amount).toBeGreaterThan(0n);
  });

  it("a failed transaction decodes to nothing", () => {
    const tx = { ...fixture("buy_v2"), failed: true };
    const d = decodeTx(tx);
    expect(d.trades).toHaveLength(0);
    expect(d.holders).toHaveLength(0);
  });
});

describe("fromHeliusRaw (V8 shape) is equivalent to the RPC shape", () => {
  it("normalizes a raw webhook element", () => {
    const rpc = fixture("buy_v2");
    const raw = fromHeliusRaw({
      slot: Number(rpc.slot), blockTime: rpc.blockTime,
      transaction: { signatures: [rpc.signature], message: { accountKeys: rpc.accountKeys, instructions: rpc.instructions.map((ix) => ({ programIdIndex: rpc.accountKeys.indexOf(ix.programId), accounts: ix.accounts.map((a) => rpc.accountKeys.indexOf(a)), data: ix.data })) } },
      meta: { err: null, logMessages: rpc.logMessages, preTokenBalances: rpc.preTokenBalances.map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount.toString(), decimals: b.decimals } })), postTokenBalances: rpc.postTokenBalances.map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount.toString(), decimals: b.decimals } })) },
    });
    expect(decodeTx(raw).trades).toEqual(decodeTx(rpc).trades);
    expect(holderUpdates(raw)).toEqual(holderUpdates(rpc));
  });
});

describe("holderUpdates", () => {
  it("sums multiple token accounts per owner and zeroes closed accounts", () => {
    const tx: NormalizedTx = { signature: "s", slot: 1n, blockTime: null, failed: false, accountKeys: [], logMessages: [], instructions: [],
      preTokenBalances: [{ accountIndex: 1, mint: "M", owner: "A", amount: 5n, decimals: 6 }, { accountIndex: 3, mint: "M", owner: "B", amount: 9n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: 1, mint: "M", owner: "A", amount: 2n, decimals: 6 }, { accountIndex: 2, mint: "M", owner: "A", amount: 4n, decimals: 6 }] };
    const h = holderUpdates(tx).sort((a, b) => a.wallet.localeCompare(b.wallet));
    expect(h).toEqual([{ mint: "M", wallet: "A", balance: 6n, slot: 1n }, { mint: "M", wallet: "B", balance: 0n, slot: 1n }]);
    expect(holderUpdates(tx, new Set(["other"]))).toEqual([]);
  });
});

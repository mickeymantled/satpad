import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AddressLookupTableAccount, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { fetchInstructions, fetchQuote, jupiterSwap, MAX_TX_BYTES, overheadLamports, swapInstructions, v0Size, type JupiterInstructions, type JupiterQuote, type SwapRpc } from "./jupiter";

const fixture = <T>(n: string) => JSON.parse(readFileSync(new URL(`../test/fixtures/jupiter/${n}`, import.meta.url), "utf8")) as T;
const q = fixture<JupiterQuote>("q_100000000.json"), si = fixture<JupiterInstructions>("si_100000000.json");
// The fixture's user; the real response's instructions reference it, so the wallet must be this key for an exact size.
const USER = new PublicKey("AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm");

/** Jupiter's tables hold the route's static accounts; the fixture omits their contents, so stand-ins are built from the instructions. */
function fakeTables(ixs: ReturnType<typeof swapInstructions>): AddressLookupTableAccount[] {
  const keys = [...new Set(ixs.flatMap((ix) => ix.keys.filter((k) => !k.isSigner).map((k) => k.pubkey.toBase58())))].map((k) => new PublicKey(k));
  const per = Math.ceil(keys.length / 3);
  return si.addressLookupTableAddresses.map((a, i) => new AddressLookupTableAccount({ key: new PublicKey(a), state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: keys.slice(i * per, (i + 1) * per) } }));
}

const fetchFor = (calls: string[]) => (async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  const body = url.includes("/swap/quote") ? q : url.includes("/swap/instructions") ? si : { error: "nope" };
  return { ok: !("error" in body), status: 200, json: async () => body } as Response;
}) as unknown as typeof fetch;

function rpc(opts: { ataExists?: boolean; simErr?: unknown; units?: number } = {}) {
  const sent: Uint8Array[] = [];
  const tables = fakeTables(swapInstructions(si));
  const r: SwapRpc = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }),
    simulateTransaction: (async () => ({ context: { slot: 1 }, value: { err: opts.simErr ?? null, logs: [], unitsConsumed: opts.units ?? 140_000 } })) as never,
    sendRawTransaction: async (raw) => { sent.push(raw as Uint8Array); return "sig1"; },
    confirmTransaction: (async () => ({ context: { slot: 1 }, value: { err: null } })) as never,
    getAccountInfo: (async () => (opts.ataExists ? { lamports: 1, data: Buffer.alloc(165), owner: PublicKey.default, executable: false } : null)) as never,
    getAddressLookupTable: (async (k: PublicKey) => ({ context: { slot: 1 }, value: tables.find((t) => t.key.equals(k)) ?? null })) as never,
  };
  return { r, sent, tables };
}
const wallet = (kp: Keypair) => ({ publicKey: kp.publicKey, signTransaction: async <T,>(tx: T) => { (tx as VersionedTransaction).sign([kp]); return tx; } });

describe("jupiter swap (V10)", () => {
  it("decodes the fixture into setup + swap + cleanup instructions that fit a v0 transaction with 3 tables", () => {
    const ixs = swapInstructions(si);
    expect(ixs).toHaveLength(6); // 4 setup, swap, cleanup
    expect(ixs[4]!.programId.toBase58()).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const size = v0Size(USER, ixs, fakeTables(ixs));
    expect(size).toBeLessThanOrEqual(MAX_TX_BYTES - 18);
    expect(size).toBeGreaterThan(400); // stand-in tables hold more keys than Jupiter's, so this is below the live 840 (V10)
  });
  it("quote and instructions go through the API proxy", async () => {
    const calls: string[] = [];
    const quote = await fetchQuote(100_000_000n, 50, fetchFor(calls));
    expect(quote.outAmount).toBe("14107");
    const ins = await fetchInstructions(quote, USER, fetchFor(calls));
    expect(ins.addressLookupTableAddresses).toHaveLength(3);
    expect(calls[0]).toMatch(/^GET .*\/swap\/quote\?lamports=100000000&slippageBps=50$/);
    expect(calls[1]).toMatch(/^POST .*\/swap\/instructions$/);
  });
  it("overhead = signature + priority fee (rounded up) + rent only when the wBTC account is new", () => {
    expect(overheadLamports({ unitsConsumed: 140_000, priorityFeeMicroLamports: 10_000n }, false)).toBe(5_000n + 1_400n) // 140k CU × 10k µL/CU = 1.4e9 µL;
    expect(overheadLamports({ unitsConsumed: 1, priorityFeeMicroLamports: 1n }, true)).toBe(5_000n + 1n + 2_039_280n);
  });
  it("swaps: loads tables, simulates, signs a v0 transaction and reports sats out", async () => {
    const kp = Keypair.generate();
    const { r, sent } = rpc({ ataExists: true });
    const status: string[] = [];
    const res = await jupiterSwap(r, wallet(kp), 100_000_000n, (s) => status.push(s), { fetchImpl: fetchFor([]), fetchFee: async () => 1_000n });
    expect(res.signature).toBe("sig1");
    expect(res.sats).toBe(14107n);
    expect(status).toEqual(["quoting", "simulating", "awaiting signature", "sending", "confirming", "confirmed"]);
    const tx = VersionedTransaction.deserialize(sent[0]!);
    expect(tx.message.addressTableLookups).toHaveLength(3);
    expect(tx.message.compiledInstructions).toHaveLength(8); // CU limit + CU price + 6
    expect(sent[0]!.length).toBeLessThanOrEqual(MAX_TX_BYTES);
  });
  it("refuses when fees and rent exceed 0.003 SOL over the input, before any wallet prompt", async () => {
    const kp = Keypair.generate();
    const { r, sent } = rpc({ ataExists: false, units: 1_000_000 });
    let prompted = false;
    const w = { publicKey: kp.publicKey, signTransaction: async <T,>(tx: T) => { prompted = true; return tx; } };
    await expect(jupiterSwap(r, w, 100_000_000n, undefined, { fetchImpl: fetchFor([]), fetchFee: async () => 5_000_000n })).rejects.toThrow(/swap refused/); // 1e6 CU × 5e6 µL/CU = 5 SOL-ish of fees
    expect(prompted).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("surfaces a failed simulation with its logs", async () => {
    const { r } = rpc({ simErr: { InstructionError: [2, "Custom"] } });
    await expect(jupiterSwap(r, wallet(Keypair.generate()), 100_000_000n, undefined, { fetchImpl: fetchFor([]), fetchFee: async () => 0n })).rejects.toThrow(/Simulation failed/);
  });
});

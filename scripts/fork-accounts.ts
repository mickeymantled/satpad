// Derives (never guesses) every non-program account create_v2 / buy_v2 touch for quote_mint = wBTC.
// Usage: npx tsx scripts/fork-accounts.ts   (read-only mainnet RPC; FORK_RPC_URL overrides)
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk, bondingCurvePda } from "@pump-fun/pump-sdk";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const WBTC = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");
async function main() {
const rpc = process.env.FORK_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");
const sdk = new OnlinePumpSdk(conn);
const global = await sdk.fetchGlobal();
const mint = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const programs = new Set<string>();
const seen = new Map<string, string>();
const idl = JSON.parse(readFileSync(new URL("../idl-ref/pump.json", import.meta.url), "utf8"));
const note = (label: string, ixn: { keys: { pubkey: PublicKey }[]; programId: PublicKey }) => {
  programs.add(ixn.programId.toBase58());
  const names: string[] = idl.instructions.find((i: { name: string }) => i.name === label).accounts.map((a: { name: string }) => a.name);
  ixn.keys.forEach((k, i) => {
    const key = k.pubkey.toBase58();
    const nm = names[i] ?? `remaining[${i - names.length}]`;
    seen.set(key, `${seen.get(key) ? seen.get(key) + " | " : ""}${label}.${nm}`);
  });
};
note("create_v2", await PUMP_SDK.createV2Instruction({
  mint, name: "t", symbol: "t", uri: "u", creator, user, mayhemMode: false,
  quoteMint: WBTC, quoteTokenProgram: TOKEN_PROGRAM_ID, creatorFeeBps: new BN(100),
}));
const curve = bondingCurvePda(mint);
note("buy_v2", await PUMP_SDK.getBuyV2InstructionRaw({
  user, mint, creator, amount: new BN(1), quoteAmount: new BN(1), quoteMint: WBTC,
  quoteTokenProgram: TOKEN_PROGRAM_ID,
}));
void TOKEN_2022_PROGRAM_ID; void curve; void global;
console.log(JSON.stringify({ global: { feeRecipient: global.feeRecipient.toBase58(), feeRecipients: global.feeRecipients.map((p) => p.toBase58()), reservedFeeRecipient: global.reservedFeeRecipient?.toBase58?.() } }, null, 1));
for (const [k, v] of seen) console.log(v, k);
}
main().catch((e) => { console.error(e); process.exit(1); });

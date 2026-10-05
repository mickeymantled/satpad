// M3: random buys and sells across the seeded coins so creator fees keep accruing during the soak.
// Usage: pnpm fork:trade [--rate-ms 2000] [--duration-s 0 (forever)] [--buy-sats 20000]
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import { COIN_TOKEN_PROGRAM, buildBuyV2, buildSellV2, coinFeePda, defaultFeeRecipients, quoteSatsForSell, quoteSatsForTokens, quoteTokensForSats, sats } from "@satpad/sdk";
import { RPC, send, KEYS_DIR } from "./lib/fork";

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const RATE = arg("rate-ms", 2000), DURATION = arg("duration-s", 0), BUY_SATS = BigInt(arg("buy-sats", 20_000));

async function main() {
  const seed = JSON.parse(readFileSync(`${KEYS_DIR}/seed.json`, "utf8")) as { wallets: Record<string, { secret: number[] }>; coins: { mint: string; symbol: string }[] };
  const trader = Keypair.fromSecretKey(Uint8Array.from(seed.wallets["trader"]!.secret));
  const conn = new Connection(RPC, "confirmed");
  const online = new OnlinePumpSdk(conn);
  const [global, feeConfig, quoteControl] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl()]);
  const recipients = defaultFeeRecipients(global);
  const start = Date.now();
  let n = 0, buys = 0, sells = 0, errors = 0;
  console.log(`trading ${seed.coins.length} coins every ${RATE} ms${DURATION ? ` for ${DURATION}s` : ""}`);
  while (!DURATION || Date.now() - start < DURATION * 1000) {
    const c = seed.coins[Math.floor(Math.random() * seed.coins.length)]!;
    const mint = new PublicKey(c.mint);
    try {
      const curve = PUMP_SDK.decodeBondingCurve((await conn.getAccountInfo(bondingCurvePda(mint), "confirmed"))!);
      if (curve.complete) continue;
      const supply = BigInt(curve.tokenTotalSupply.toString());
      const userAta = getAssociatedTokenAddressSync(mint, trader.publicKey, true, COIN_TOKEN_PROGRAM);
      const held = await getAccount(conn, userAta, "confirmed", COIN_TOKEN_PROGRAM).then((a) => a.amount).catch(() => 0n);
      const doSell = held > 0n && Math.random() < 0.4;
      if (doSell) {
        const amount = held / 2n + 1n;
        const out = quoteSatsForSell({ global, feeConfig, mintSupply: supply, bondingCurve: curve, quoteControl }, amount);
        await send(conn, [await buildSellV2({ user: trader.publicKey, mint, creator: coinFeePda(mint)[0], recipients, tokenAmount: amount, minQuoteOut: sats((out * 95n) / 100n) })], [trader]);
        sells++;
      } else {
        const spend = BUY_SATS + BigInt(Math.floor(Math.random() * Number(BUY_SATS)));
        const tokens = quoteTokensForSats({ global, feeConfig, mintSupply: supply, bondingCurve: curve, quoteControl }, spend);
        if (tokens <= 0n) continue;
        const cost = quoteSatsForTokens({ global, feeConfig, mintSupply: supply, bondingCurve: curve, quoteControl }, tokens);
        await send(conn, await buildBuyV2({ user: trader.publicKey, mint, creator: coinFeePda(mint)[0], recipients, tokenAmount: tokens, maxQuoteIn: sats((cost * 105n) / 100n + 1n) }), [trader]);
        buys++;
      }
    } catch (e) {
      errors++;
      console.error(`trade error on ${c.symbol}: ${(e as Error).message.split("\n")[0]}`);
    }
    if (++n % 25 === 0) console.log(JSON.stringify({ trades: n, buys, sells, errors, elapsedS: Math.round((Date.now() - start) / 1000) }));
    await new Promise((r) => setTimeout(r, RATE));
  }
  console.log(JSON.stringify({ done: true, trades: n, buys, sells, errors }));
}
main().catch((e) => { console.error(e); process.exit(1); });

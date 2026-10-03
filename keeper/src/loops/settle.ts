// Claim-and-settle loop (SPEC "Keeper service", first row). Every 60 s, for each registered coin with unclaimed creator
// fees above the dust threshold: pump.fun collect_creator_fee_v2 → satpad_vault::settle → pay_payee when the payee
// has a quote ATA. Per-coin isolation: one coin failing never blocks the others. Idempotent: every step re-reads
// balances, so a crash between steps just means the next tick finishes the job.
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ammCreatorVaultPda } from "@pump-fun/pump-sdk";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, buildCollectCreatorFeeV2, buildPayPayee, buildSettle, coinAccounts, coinFeePda, payeePotPda, splitFee, type Config } from "@satpad/sdk";
import type { ChainReader } from "../chain";
import type { LedgerEntry } from "../ledger";
import type { Logger } from "../log";
import type { RegisteredCoin } from "../coins";

/** The slice of `Sender` the loop uses; a recording fake in tests. */
export interface TxSender { send(entry: LedgerEntry, ixs: TransactionInstruction[], signers: Keypair[]): Promise<{ signature: string }> }

export interface SettleDeps {
  chain: ChainReader;
  sender: TxSender;
  keeper: Keypair;
  dustThreshold: bigint;
  log: Logger;
}

export interface CoinOutcome { mint: string; collected?: bigint; settled?: bigint; paid?: bigint; skipped?: string; error?: string }
export interface TickSummary { coins: number; collected: number; settled: number; paid: number; failed: number; outcomes: CoinOutcome[] }

const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(BTC_QUOTE_MINT, owner, true, BTC_QUOTE_TOKEN_PROGRAM);

export async function settleTick(deps: SettleDeps, config: Config, coins: RegisteredCoin[]): Promise<TickSummary> {
  const summary: TickSummary = { coins: coins.length, collected: 0, settled: 0, paid: 0, failed: 0, outcomes: [] };
  if (config.paused) {
    deps.log.warn("vault is paused; settle loop idle");
    summary.outcomes = coins.map((c) => ({ mint: c.mint.toBase58(), skipped: "vault paused" }));
    return summary;
  }
  for (const coin of coins) {
    const out: CoinOutcome = { mint: coin.mint.toBase58() };
    try {
      await settleOne(deps, config, coin, out);
    } catch (e) {
      out.error = (e as Error).message;
      summary.failed++;
      deps.log.error("coin failed", { mint: out.mint, error: out.error });
    }
    if (out.collected !== undefined) summary.collected++;
    if (out.settled !== undefined) summary.settled++;
    if (out.paid !== undefined) summary.paid++;
    summary.outcomes.push(out);
  }
  return summary;
}

async function settleOne(deps: SettleDeps, config: Config, coin: RegisteredCoin, out: CoinOutcome): Promise<void> {
  const log = deps.log.child({ mint: out.mint });
  if (coin.paused) { out.skipped = "coin paused"; return; }
  const [coinFee] = coinFeePda(coin.mint);
  const accts = coinAccounts(coin.mint, coinFee);
  const ammVaultAta = ata(ammCreatorVaultPda(coinFee));
  const actor = deps.keeper.publicKey.toBase58();

  const bal = await deps.chain.tokenBalances([accts.creatorVaultQuoteAta, accts.creatorQuoteAta, ammVaultAta]);
  const unclaimed = bal[0] ?? null, waiting = bal[1] ?? null, ammUnclaimed = bal[2] ?? null;
  if (ammUnclaimed && ammUnclaimed > 0n) log.warn("graduated coin has PumpSwap creator fees waiting; AMM collect arrives in M6", { ammUnclaimed });
  if (waiting === null) throw new Error("CoinFee ATA missing — coin not declared through satpad_vault?");

  // 1. claim: pump's permissionless collect into the CoinFee ATA
  let collected = 0n;
  if (unclaimed !== null && unclaimed >= deps.dustThreshold) {
    await deps.sender.send({ type: "collect_creator_fee", mint: out.mint, actor, amounts: { unclaimed: unclaimed.toString() } }, [await buildCollectCreatorFeeV2(coinFee)], [deps.keeper]);
    collected = unclaimed;
    out.collected = collected;
  }

  // 2. settle whatever sits in the CoinFee ATA (re-read: never trust arithmetic over a prior read)
  const toSettle = collected > 0n ? (await deps.chain.tokenBalance(accts.creatorQuoteAta)) ?? 0n : waiting;
  if (toSettle >= deps.dustThreshold) {
    const s = coin.treasuryOnly ? { liquidity: 0n, buyback: 0n, operator: toSettle, deployer: 0n } : splitFee(toSettle, config.split);
    await deps.sender.send(
      { type: "settle", mint: out.mint, actor, amounts: { fee: toSettle.toString(), liquidity: s.liquidity.toString(), buyback: s.buyback.toString(), operator: s.operator.toString(), deployer: s.deployer.toString() } },
      [await buildSettle({ mint: coin.mint, buybackWallet: config.buybackWallet, treasury: config.treasury })],
      [deps.keeper],
    );
    out.settled = toSettle;
  }

  // 3. pay the payee when they have an ATA (SPEC: never pay rent to create one)
  if (coin.payeeMode === "wallet" && !coin.treasuryOnly) {
    const pb = await deps.chain.tokenBalances([payeePotPda(coin.mint)[0], ata(coin.payee)]);
    const pot = pb[0] ?? null, payeeAta = pb[1] ?? null;
    if (pot && pot > 0n) {
      if (payeeAta === null) {
        log.info("payee has no quote ATA; share waits in PayeePot", { pot });
      } else {
        await deps.sender.send({ type: "pay_payee", mint: out.mint, actor, amounts: { amount: pot.toString() } }, [await buildPayPayee({ mint: coin.mint, payee: coin.payee })], [deps.keeper]);
        out.paid = pot;
      }
    }
  }
  if (out.collected === undefined && out.settled === undefined && out.paid === undefined) out.skipped = "nothing to do";
}

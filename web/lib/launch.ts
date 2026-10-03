"use client";
// Launch transaction (SPEC "Creation (one transaction)", DECISIONS D4/D14): create_v2 with creator = CoinFee PDA,
// declare_coin (takes the launch fee and writes the payee choice; signed by user + mint), optional first buy. One v0
// transaction over the pinned lookup table. The SOL → BTC swap, when needed, runs first as its own transaction.
import { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import type { FeeConfig, Global, QuoteControl } from "@pump-fun/pump-sdk";
import { DEFAULT_CREATOR_FEE_BPS, buildBuyV2, buildCreateV2, buildDeclareCoin, coinFeePda, configPda, decodeConfig, defaultFeeRecipients, quoteSatsForTokens, quoteTokensForSats, type FeeRecipients, type PayeeChoice } from "@satpad/sdk";
import { env } from "./env";
import { api } from "./api";

export interface LaunchContext { treasury: PublicKey; launchFeeLamports: bigint; creatorFeeBps: number; recipients: FeeRecipients; table: AddressLookupTableAccount; global: Global; feeConfig: FeeConfig | null; quoteControl: QuoteControl | null; metadataBackend: "pump" | "api" }

/** Reads everything a launch needs: vault Config, pump globals, fee recipients, the lookup table (web env or API config). */
export async function loadLaunchContext(connection: Connection): Promise<LaunchContext> {
  const [cfgInfo, apiCfg] = await Promise.all([connection.getAccountInfo(configPda()[0], "confirmed"), api.config({ cache: "no-store" })]);
  if (!cfgInfo) throw new Error("satpad_vault is not initialized on this cluster");
  const cfg = decodeConfig(cfgInfo.data);
  const alt = env.launchAlt || apiCfg.launchAlt;
  if (!alt) throw new Error("launch lookup table not configured (NEXT_PUBLIC_LAUNCH_ALT / LAUNCH_ALT)");
  const online = new OnlinePumpSdk(connection);
  const [global, feeConfig, quoteControl, table] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl(), connection.getAddressLookupTable(new PublicKey(alt))]);
  if (!table.value) throw new Error(`launch lookup table ${alt} not found`);
  return { treasury: cfg.treasury, launchFeeLamports: cfg.launchFeeLamports, creatorFeeBps: cfg.creatorFeeBps, recipients: defaultFeeRecipients(global), table: table.value, global, feeConfig, quoteControl, metadataBackend: apiCfg.metadataBackend };
}

/** Tokens the first buy of a brand-new curve returns for `sats`, and the sats that amount actually costs. */
export function quoteFirstBuy(ctx: Pick<LaunchContext, "global" | "feeConfig" | "quoteControl" | "creatorFeeBps">, sats: bigint): { tokens: bigint; cost: bigint } {
  const i = { global: ctx.global, feeConfig: ctx.feeConfig, quoteControl: ctx.quoteControl, mintSupply: null, bondingCurve: null, creatorFeeBps: ctx.creatorFeeBps || DEFAULT_CREATOR_FEE_BPS };
  const tokens = quoteTokensForSats(i, sats);
  return { tokens, cost: tokens > 0n ? quoteSatsForTokens(i, tokens) : 0n };
}

export interface LaunchParams { user: PublicKey; mint: PublicKey; name: string; symbol: string; uri: string; payee: PayeeChoice; treasury: PublicKey; recipients: FeeRecipients; creatorFeeBps?: number; firstBuy?: { tokenAmount: bigint; maxQuoteIn: bigint } }

/** [create_v2, declare_coin, (create coin ATA, buy_v2)]. SPEC's separate launch-fee transfer is inside declare_coin (M2). */
export async function buildLaunchIxs(p: LaunchParams): Promise<TransactionInstruction[]> {
  const [coinFee] = coinFeePda(p.mint);
  const ixs = [
    await buildCreateV2({ mint: p.mint, name: p.name, symbol: p.symbol, uri: p.uri, creator: coinFee, user: p.user, ...(p.creatorFeeBps && { creatorFeeBps: p.creatorFeeBps }) }),
    await buildDeclareCoin({ user: p.user, mint: p.mint, treasury: p.treasury, payee: p.payee }),
  ];
  if (p.firstBuy) ixs.push(...(await buildBuyV2({ user: p.user, mint: p.mint, creator: coinFee, recipients: p.recipients, tokenAmount: p.firstBuy.tokenAmount, maxQuoteIn: p.firstBuy.maxQuoteIn })));
  return ixs;
}

/** Form validation mirrored from the API (SPEC "Metadata"): name ≤ 32 bytes, symbol 1..10. */
export function validateLaunchForm(f: { name: string; symbol: string; payeeKind: string; payeeWallet: string; image: string }): string | null {
  const name = f.name.trim();
  if (!name) return "Name is required";
  if (new TextEncoder().encode(name).length > 32) return "Name must be at most 32 bytes";
  if (!/^[A-Za-z0-9_.$-]{1,10}$/.test(f.symbol.trim())) return "Symbol: 1–10 letters, digits, _ . $ -";
  if (!f.image) return "Image is required";
  if (f.payeeKind === "wallet") { try { new PublicKey(f.payeeWallet.trim()); } catch { return "Payee wallet is not a valid address"; } }
  return null;
}

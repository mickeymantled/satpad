// pump.fun v2 wrappers pinned to the BTC quote mint. Thin layer over @pump-fun/pump-sdk 2.0.0's offline builders:
// bigint in, TransactionInstruction out, quote mint / token program / mayhem / holder-reward flags fixed so a
// caller cannot create or trade a Satpad coin with the wrong quote. Account lists come from the SDK's IDL
// (idl-ref/pump.json, VERIFIED V3); tests assert them.
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PUMP_SDK, bondingCurvePda, creatorVaultPda, getPumpProgram, getBuySolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import type { BondingCurve, FeeConfig, Global, QuoteControl } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { BTC_QUOTE_MINT, BTC_QUOTE_TOKEN_PROGRAM, DEFAULT_CREATOR_FEE_BPS, MAX_CREATOR_FEE_BPS } from "./quoteMints";

/** Satpad coins are Token-2022 mints (pump.fun `create_v2` → `token_program` = Token-2022, VERIFIED V3). */
export const COIN_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

/** pump.fun coins have 6 decimals; `tokenTotalSupply` is 1e9 tokens = 1e15 base units. */
export const COIN_DECIMALS = 6;

/**
 * Buyback fee recipients pump-sdk 2.0.0 chooses from at random (`CURRENT_FEE_RECIPIENTS_FOR_BUYBACK`, not exported).
 * Pinned here so the keeper and local fork use a deterministic one; the test checks this list against the SDK source.
 */
export const PUMP_BUYBACK_FEE_RECIPIENTS: readonly PublicKey[] = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((s) => new PublicKey(s));

const bn = (v: bigint): BN => new BN(v.toString());
const big = (v: BN): bigint => BigInt(v.toString());

export interface FeeRecipients {
  /** `Global.fee_recipient` (deterministic) or any entry of `Global.fee_recipients`. */
  feeRecipient: PublicKey;
  /** One of {@link PUMP_BUYBACK_FEE_RECIPIENTS}. */
  buybackFeeRecipient: PublicKey;
}

/** Index into {@link PUMP_BUYBACK_FEE_RECIPIENTS} used by default; the local fork clones this one and its wBTC ATA. */
export const DEFAULT_BUYBACK_RECIPIENT_INDEX = 1;

/** Deterministic recipients: Global's primary fee recipient and the pinned buyback recipient. */
export function defaultFeeRecipients(global: Pick<Global, "feeRecipient">): FeeRecipients {
  return { feeRecipient: global.feeRecipient, buybackFeeRecipient: PUMP_BUYBACK_FEE_RECIPIENTS[DEFAULT_BUYBACK_RECIPIENT_INDEX]! };
}

export interface CreateV2Params {
  /** New mint keypair's pubkey; the keypair must sign. */
  mint: PublicKey;
  name: string; // ≤ 32 bytes (pump.fun)
  symbol: string;
  uri: string;
  /**
   * pump.fun `creator`: receives all creator fees. For Satpad coins this is the `CoinFee` PDA (DECISIONS D4).
   * A plain pubkey — it does not sign.
   */
  creator: PublicKey;
  /** Payer and signer. */
  user: PublicKey;
  /** 1..=MAX_CREATOR_FEE_BPS. Default DEFAULT_CREATOR_FEE_BPS. */
  creatorFeeBps?: number;
}

/** `create_v2` with `quote_mint = BTC_QUOTE_MINT`, mayhem off, holder-reward off, cashback off. */
export async function buildCreateV2(p: CreateV2Params): Promise<TransactionInstruction> {
  const creatorFeeBps = p.creatorFeeBps ?? DEFAULT_CREATOR_FEE_BPS;
  if (!Number.isInteger(creatorFeeBps) || creatorFeeBps < 1 || creatorFeeBps > MAX_CREATOR_FEE_BPS) {
    throw new RangeError(`creatorFeeBps must be 1..=${MAX_CREATOR_FEE_BPS}, got ${creatorFeeBps}`);
  }
  if (Buffer.byteLength(p.name, "utf8") > 32) throw new RangeError("name exceeds 32 bytes");
  if (p.creator.equals(PublicKey.default)) throw new RangeError("creator must not be the default pubkey");
  return PUMP_SDK.createV2Instruction({
    mint: p.mint,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    creator: p.creator,
    user: p.user,
    mayhemMode: false,
    holderReward: false,
    quoteMint: BTC_QUOTE_MINT,
    quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
    creatorFeeBps: new BN(creatorFeeBps),
  });
}

export interface TradeV2Params {
  user: PublicKey;
  mint: PublicKey;
  /** `bonding_curve.creator` — needed to derive `creator_vault`. */
  creator: PublicKey;
  recipients: FeeRecipients;
}

export interface BuyV2Params extends TradeV2Params {
  /** Tokens out, base units (6 decimals). */
  tokenAmount: bigint;
  /** Slippage cap: max BTC in, base units (sats). */
  maxQuoteIn: bigint;
}

/** `buy_v2`. Returns `[create user token ATA (idempotent), buy_v2]`. */
export async function buildBuyV2(p: BuyV2Params): Promise<TransactionInstruction[]> {
  const ata = getAssociatedTokenAddressSync(p.mint, p.user, true, COIN_TOKEN_PROGRAM);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.user, ata, p.user, p.mint, COIN_TOKEN_PROGRAM),
    await PUMP_SDK.getBuyV2InstructionRaw({
      user: p.user,
      mint: p.mint,
      creator: p.creator,
      amount: bn(p.tokenAmount),
      quoteAmount: bn(p.maxQuoteIn),
      feeRecipient: p.recipients.feeRecipient,
      buybackFeeRecipient: p.recipients.buybackFeeRecipient,
      tokenProgram: COIN_TOKEN_PROGRAM,
      quoteMint: BTC_QUOTE_MINT,
      quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
    }),
  ];
}

export interface SellV2Params extends TradeV2Params {
  /** Tokens in, base units. */
  tokenAmount: bigint;
  /** Slippage floor: min BTC out, base units (sats). */
  minQuoteOut: bigint;
}

/** `sell_v2`. The user's wBTC ATA must exist (the SDK does not create it; callers add an idempotent create). */
export async function buildSellV2(p: SellV2Params): Promise<TransactionInstruction> {
  return PUMP_SDK.getSellV2InstructionRaw({
    user: p.user,
    mint: p.mint,
    creator: p.creator,
    amount: bn(p.tokenAmount),
    quoteAmount: bn(p.minQuoteOut),
    feeRecipient: p.recipients.feeRecipient,
    buybackFeeRecipient: p.recipients.buybackFeeRecipient,
    tokenProgram: COIN_TOKEN_PROGRAM,
    quoteMint: BTC_QUOTE_MINT,
    quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
  });
}

// Anchor's Program needs a Connection object to construct but `.instruction()` never touches the network.
const offlineProgram = () => getPumpProgram(new Connection("http://127.0.0.1:1"));

/**
 * `collect_creator_fee_v2` for the bonding-curve creator vault. Permissionless; `creator` does not sign
 * (VERIFIED V4). Pays into `ATA(creator, BTC_QUOTE_MINT)`, which must already exist.
 */
export async function buildCollectCreatorFeeV2(creator: PublicKey): Promise<TransactionInstruction> {
  return offlineProgram()
    .methods.collectCreatorFeeV2()
    .accountsPartial({
      creator,
      quoteMint: BTC_QUOTE_MINT,
      quoteTokenProgram: BTC_QUOTE_TOKEN_PROGRAM,
      creatorVault: creatorVaultPda(creator),
    })
    .instruction();
}

/** Addresses the keeper and indexer watch for a coin. */
export function coinAccounts(mint: PublicKey, creator: PublicKey) {
  return {
    bondingCurve: bondingCurvePda(mint),
    creatorVault: creatorVaultPda(creator),
    creatorVaultQuoteAta: getAssociatedTokenAddressSync(BTC_QUOTE_MINT, creatorVaultPda(creator), true, BTC_QUOTE_TOKEN_PROGRAM),
    creatorQuoteAta: getAssociatedTokenAddressSync(BTC_QUOTE_MINT, creator, true, BTC_QUOTE_TOKEN_PROGRAM),
  };
}

export interface CurveMathInputs {
  global: Global;
  feeConfig: FeeConfig | null;
  /** Current mint supply (base units) or null for a curve that does not exist yet. */
  mintSupply: bigint | null;
  /** null = quote for the first buy of a not-yet-created curve. */
  bondingCurve: BondingCurve | null;
  quoteControl?: QuoteControl | null;
  /** Only used when bondingCurve is null. */
  creatorFeeBps?: number;
}

/** Tokens out for `sats` of BTC in, after fees. bigint wrapper over the SDK curve math. */
export function quoteTokensForSats(i: CurveMathInputs, sats: bigint): bigint {
  return big(getBuyTokenAmountFromSolAmount({ ...curveArgs(i), amount: bn(sats) }));
}

/** BTC in (sats) to receive `tokens`, including fees. */
export function quoteSatsForTokens(i: CurveMathInputs, tokens: bigint): bigint {
  return big(getBuySolAmountFromTokenAmount({ ...curveArgs(i), amount: bn(tokens) }));
}

/** BTC out (sats) for selling `tokens`, after fees. */
export function quoteSatsForSell(i: CurveMathInputs & { mintSupply: bigint; bondingCurve: BondingCurve }, tokens: bigint): bigint {
  return big(getSellSolAmountFromTokenAmount({ global: i.global, feeConfig: i.feeConfig, mintSupply: bn(i.mintSupply), bondingCurve: i.bondingCurve, amount: bn(tokens) }));
}

function curveArgs(i: CurveMathInputs) {
  return {
    global: i.global,
    feeConfig: i.feeConfig,
    mintSupply: i.mintSupply === null ? null : bn(i.mintSupply),
    bondingCurve: i.bondingCurve,
    quoteMint: BTC_QUOTE_MINT,
    quoteControl: i.quoteControl ?? null,
    creatorFeeBps: new BN(i.creatorFeeBps ?? DEFAULT_CREATOR_FEE_BPS),
  };
}

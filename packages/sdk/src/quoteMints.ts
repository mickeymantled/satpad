// Pinned quote-mint facts. Every value here is human-approved and live-verified; see VERIFIED.md V1/V2 and
// DECISIONS.md D2/D3. Do not add a second mint without re-running the verification checklist.
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Wormhole Portal wBTC (bridged Ethereum WBTC). The only BTC mint in pump.fun's QuoteControl on mainnet (2026-10-02). */
export const BTC_QUOTE_MINT = new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");

/** wBTC is a classic SPL Token mint (not Token-2022). Passed as `quote_token_program` to pump.fun v2 instructions. */
export const BTC_QUOTE_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

/** 8 decimals: 1 base unit = 1 satoshi. Never assume 6 or 9 (SPEC "Decimals"). */
export const BTC_QUOTE_DECIMALS = 8;

/** Base units per whole BTC. */
export const SATS_PER_BTC = 100_000_000n;

/**
 * Creator fee passed to `create_v2` for every Satpad coin (DECISIONS D3). pump.fun's program accepts up to
 * `Global.max_configurable_creator_fee_bps` (300 on 2026-10-02) but its published Custom Pairs range tops out at 1%.
 */
export const DEFAULT_CREATOR_FEE_BPS = 100;

/**
 * Hard ceiling enforced by `satpad_vault` as a program constant (`MAX_CREATOR_FEE_BPS`), so raising it needs a
 * program upgrade through the multisig. The on-chain program test asserts the two constants are equal.
 */
export const MAX_CREATOR_FEE_BPS = 100;

/** pump.fun QuoteControl `initial_virtual_quote_reserves` for wBTC, base units (VERIFIED V1). Used for curve math checks. */
export const BTC_INITIAL_VIRTUAL_QUOTE_RESERVES = 5_082_192n;

/** pump.fun program ids (mainnet; identical on devnet). VERIFIED.md "Program ids". */
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

/** pump.fun singleton PDAs (VERIFIED V1, V13). */
export const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const PUMP_QUOTE_CONTROL = new PublicKey("6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP");

/**
 * pump.fun `Global.initial_real_token_reserves`: tokens the curve sells before it completes. Observed on every curve
 * created on the fork (VERIFIED V13 smoke: `real_token_reserves = 793099000000000` right after create_v2) and the
 * standard pump value (1e9 supply, 206.9M to the pool). Curve progress = 1 − real_token_reserves / this.
 */
export const INITIAL_REAL_TOKEN_RESERVES = 793_099_000_000_000n;

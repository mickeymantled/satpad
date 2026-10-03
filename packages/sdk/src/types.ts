// TypeScript views of satpad_vault accounts (SPEC "satpad_vault program → Accounts"). These are the shapes the
// Anchor IDL will produce in milestone 2; the decode layer will map IDL types onto them. Amounts are bigint.
import type { PublicKey } from "@solana/web3.js";
import type { FeeSplitBps } from "./amounts";

export interface Config {
  admin: PublicKey;
  treasury: PublicKey;
  buybackWallet: PublicKey;
  rewardsWallet: PublicKey;
  lpWallet: PublicKey;
  quoteMint: PublicKey;
  quoteDecimals: number;
  split: FeeSplitBps;
  /** Max base units one `draw_lp` may move. Capped by a program constant. */
  lpDrawMax: bigint;
  /** Seconds between draws. Never below 300. */
  lpDrawIntervalSecs: bigint;
  /** Creator fee passed to `create_v2` for new coins. Capped by `MAX_CREATOR_FEE_BPS` (DECISIONS D3). */
  creatorFeeBps: number;
  paused: boolean;
  launchFeeLamports: bigint;
  /** Set after $SATPAD graduates; zero until then. */
  satpadMint: PublicKey;
  satpadPool: PublicKey;
  satpadLpMint: PublicKey;
  lastLpDrawTs: bigint;
}

export type PayeeMode = "me" | "wallet" | "holders";

export interface Coin {
  mint: PublicKey;
  deployer: PublicKey;
  /** Current payee. Ignored when `payeeMode === "holders"`. */
  payee: PublicKey;
  payeeMode: PayeeMode;
  paused: boolean;
  createdAt: bigint;
  declared: boolean;
  /** $SATPAD only: 100% of creator fee to treasury. Set at init, never changed. */
  treasuryOnly: boolean;
  lastRewardsRunTs: bigint;
  rewardsRunCount: bigint;
}

export interface RewardsRun {
  mint: PublicKey;
  runIndex: bigint;
  snapshotSha256: Uint8Array; // 32 bytes
  slot: bigint;
  amountReleased: bigint;
  timestamp: bigint;
}

export type Stage = "dust" | "mining" | "block";

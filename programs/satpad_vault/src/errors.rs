use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("split shares must sum to 10000 bps")]
    SplitSum,
    #[msg("liquidity share below the program minimum")]
    LiquidityTooLow,
    #[msg("operator share above the program maximum")]
    OperatorTooHigh,
    #[msg("creator fee bps must be in 1..=MAX_CREATOR_FEE_BPS")]
    CreatorFeeOutOfRange,
    #[msg("lp_draw_max above the program cap")]
    LpDrawMaxTooHigh,
    #[msg("lp_draw_interval below the program minimum")]
    LpDrawIntervalTooShort,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("wrong quote mint")]
    WrongQuoteMint,
    #[msg("bonding curve account data is not a pump.fun BondingCurve")]
    BadCurveData,
    #[msg("bonding curve creator is not this coin's CoinFee PDA")]
    WrongCurveCreator,
    #[msg("bonding curve quote mint is not the configured BTC quote mint")]
    WrongCurveQuoteMint,
    #[msg("bonding curve creator_fee_bps does not equal Config.creator_fee_bps")]
    CreatorFeeMismatch,
    #[msg("holder-reward curves cannot be registered: pump.fun owns their creator")]
    HolderRewardCurve,
    #[msg("mayhem-mode curves cannot be registered")]
    MayhemCurve,
    #[msg("signer is not the admin")]
    NotAdmin,
    #[msg("treasury account does not match Config.treasury")]
    WrongTreasury,
    #[msg("vault is paused")]
    Paused,
    #[msg("coin is paused")]
    CoinPaused,
    #[msg("signer is not the coin's current payee")]
    NotPayee,
    #[msg("coin is in holder-rewards mode; nobody controls the deployer share")]
    HoldersMode,
    #[msg("new payee must be a real, different wallet")]
    InvalidPayee,
    #[msg("signer is not Config.rewards_wallet")]
    NotRewardsWallet,
    #[msg("signer is not Config.lp_wallet")]
    NotLpWallet,
    #[msg("rewards pot below the minimum release amount")]
    RewardsPotBelowMin,
    #[msg("last rewards run is less than REWARDS_RUN_MIN_INTERVAL seconds old")]
    RewardsTooSoon,
    #[msg("coin is not in holder-rewards mode")]
    NotHoldersMode,
    #[msg("draw exceeds Config.lp_draw_max")]
    LpDrawTooLarge,
    #[msg("last LP draw is less than Config.lp_draw_interval seconds old")]
    LpDrawTooSoon,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("recover requires the coin to be paused")]
    CoinNotPaused,
    #[msg("recovery destination must be the ATA of the fixed RECOVERY_ADDRESS")]
    WrongRecoveryDestination,
    #[msg("wallet must not be the default pubkey")]
    InvalidWallet,
    #[msg("$SATPAD mint/pool/LP mint already set; changing them requires a program upgrade (D21)")]
    SatpadAlreadySet,
}

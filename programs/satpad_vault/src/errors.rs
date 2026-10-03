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
}

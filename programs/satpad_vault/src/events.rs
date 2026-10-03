use anchor_lang::prelude::*;
use crate::state::{PayeeMode, Split};

#[event]
pub struct Initialized {
    pub admin: Pubkey,
    pub quote_mint: Pubkey,
    pub quote_decimals: u8,
    pub split: Split,
    pub creator_fee_bps: u16,
    pub lp_draw_max: u64,
    pub lp_draw_interval: i64,
}

#[event]
pub struct Declared {
    pub mint: Pubkey,
    pub deployer: Pubkey,
    pub payee: Pubkey,
    pub payee_mode: PayeeMode,
    pub treasury_only: bool,
    pub creator_fee_bps: u16,
    pub launch_fee_lamports: u64,
}

#[event]
pub struct Settled {
    pub mint: Pubkey,
    pub amount: u64,
    pub liquidity: u64,
    pub buyback: u64,
    pub operator: u64,
    pub deployer: u64,
    /// `PayeePot`, `RewardsPot`, or the treasury ATA for a treasury-only coin.
    pub deployer_destination: Pubkey,
    pub split: Split,
}

#[event]
pub struct PayeePaid {
    pub mint: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PayeeRedirected {
    pub mint: Pubkey,
    pub old_payee: Pubkey,
    pub new_payee: Pubkey,
    /// Paid to the old payee in the same instruction.
    pub paid_out: u64,
}

#[event]
pub struct HolderRewardsSet {
    pub mint: Pubkey,
    pub old_payee: Pubkey,
    pub paid_out: u64,
}

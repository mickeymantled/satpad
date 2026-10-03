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

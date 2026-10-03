use anchor_lang::prelude::*;
use crate::state::Split;

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

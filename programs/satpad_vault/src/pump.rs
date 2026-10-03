//! Read-only view of pump.fun's `BondingCurve` account. Layout pinned from `idl-ref/pump.json` (pump-sdk 2.0.0,
//! VERIFIED V3): 8-byte discriminator then 117 bytes of fields, 125 total. Satpad never writes this account.
use anchor_lang::prelude::*;

pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
pub const BONDING_CURVE_SIZE: usize = 125;

#[derive(AnchorDeserialize, Clone, Debug)]
pub struct BondingCurve {
    pub virtual_token_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub real_token_reserves: u64,
    pub real_quote_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub creator: Pubkey,
    pub is_mayhem_mode: bool,
    pub is_cashback_coin: bool,
    pub quote_mint: Pubkey,
    pub creator_fee_bps: u64,
    pub can_edit_creator_fee: bool,
    pub is_holder_reward: bool,
}

impl BondingCurve {
    /// Parses raw account data, checking the discriminator and minimum size. Owner and PDA checks are done by the
    /// account constraints in the instruction, not here.
    pub fn parse(data: &[u8]) -> Result<Self> {
        require!(data.len() >= BONDING_CURVE_SIZE, crate::errors::VaultError::BadCurveData);
        require!(data[..8] == BONDING_CURVE_DISCRIMINATOR, crate::errors::VaultError::BadCurveData);
        let mut slice = &data[8..BONDING_CURVE_SIZE];
        Self::deserialize(&mut slice).map_err(|_| error!(crate::errors::VaultError::BadCurveData))
    }
}

use anchor_lang::prelude::*;

/// Fee split in basis points of the creator fee. Sum is always 10000.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct Split {
    pub liquidity_bps: u16,
    pub buyback_bps: u16,
    pub operator_bps: u16,
    pub deployer_bps: u16,
}

/// Singleton `["config"]`. SPEC "Accounts (PDAs)" plus `creator_fee_bps` (D3) and the $SATPAD pool addresses.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Hot key: pause, split, wallet changes. Cannot upgrade, cannot set LP params, cannot touch payees.
    pub admin: Pubkey,
    /// Operator share and launch fees.
    pub treasury: Pubkey,
    /// Buyback share; keeper swaps it for $SATPAD and burns.
    pub buyback_wallet: Pubkey,
    /// Only destination of `release_rewards`.
    pub rewards_wallet: Pubkey,
    /// Only signer of `draw_lp`. Set by the upgrade authority via `set_lp`.
    pub lp_wallet: Pubkey,
    /// The BTC quote mint every pot is denominated in. All token accounts are validated against it.
    pub quote_mint: Pubkey,
    /// Read from the mint at init (8 for wBTC). Never assumed.
    pub quote_decimals: u8,
    pub split: Split,
    /// Max base units per `draw_lp`. ≤ LP_DRAW_MAX_CAP.
    pub lp_draw_max: u64,
    /// Seconds between draws. ≥ MIN_LP_DRAW_INTERVAL.
    pub lp_draw_interval: i64,
    pub last_lp_draw_ts: i64,
    /// Creator fee every registered coin must have been created with (D3, D9). 1..=MAX_CREATOR_FEE_BPS.
    pub creator_fee_bps: u16,
    /// Global pause: every coin's `settle` refuses.
    pub paused: bool,
    /// Lamports `declare_coin` transfers to treasury.
    pub launch_fee_lamports: u64,
    /// $SATPAD mint, PumpSwap pool and LP mint once bootstrapped; default until then.
    pub satpad_mint: Pubkey,
    pub satpad_pool: Pubkey,
    pub satpad_lp_mint: Pubkey,
    pub bump: u8,
    pub lp_pot_bump: u8,
}

/// Who receives the deployer share. `Holders` is permanent (SPEC "Payee modes").
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum PayeeMode {
    Wallet,
    Holders,
}

/// Deployer's choice at launch, written once by `declare_coin`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayeeChoice {
    /// The launching wallet.
    Me,
    /// Any wallet; it controls the share from the start.
    Wallet(Pubkey),
    /// Pro rata to holders, forever.
    Holders,
}

/// `["coin", mint]`.
#[account]
#[derive(InitSpace)]
pub struct Coin {
    pub mint: Pubkey,
    pub deployer: Pubkey,
    /// Current payee when `payee_mode == Wallet`; ignored for `Holders`.
    pub payee: Pubkey,
    pub payee_mode: PayeeMode,
    pub paused: bool,
    pub created_at: i64,
    pub declared: bool,
    /// $SATPAD only: 100% of the creator fee to treasury. Admin-set at declaration, never changed.
    pub treasury_only: bool,
    pub last_rewards_run_ts: i64,
    pub rewards_run_count: u64,
    pub bump: u8,
    pub coin_fee_bump: u8,
    pub payee_pot_bump: u8,
    pub rewards_pot_bump: u8,
}

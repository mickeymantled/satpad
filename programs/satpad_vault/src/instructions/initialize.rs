use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::Initialized;
use crate::state::{Config, Split};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub buyback_wallet: Pubkey,
    pub rewards_wallet: Pubkey,
    pub lp_wallet: Pubkey,
    pub split: Split,
    pub lp_draw_max: u64,
    pub lp_draw_interval: i64,
    pub creator_fee_bps: u16,
    pub launch_fee_lamports: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Deployer; pays rent. Runs once because `config` is `init`.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, Config>,

    /// The BTC quote mint. Decimals are read from here, never assumed.
    pub quote_mint: InterfaceAccount<'info, Mint>,

    /// `["lp_pot"]`: token account holding the liquidity share from every coin. Authority is `config`; only
    /// `draw_lp` can move it out.
    #[account(
        init, payer = payer,
        seeds = [SEED_LP_POT], bump,
        token::mint = quote_mint, token::authority = config, token::token_program = quote_token_program,
    )]
    pub lp_pot: InterfaceAccount<'info, TokenAccount>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn validate_split(s: &Split) -> Result<()> {
    let sum = (s.liquidity_bps as u32) + (s.buyback_bps as u32) + (s.operator_bps as u32) + (s.deployer_bps as u32);
    require!(sum == BPS_DENOMINATOR as u32, VaultError::SplitSum);
    require!(s.liquidity_bps >= MIN_LIQUIDITY_BPS, VaultError::LiquidityTooLow);
    require!(s.operator_bps <= MAX_OPERATOR_BPS, VaultError::OperatorTooHigh);
    Ok(())
}

pub fn validate_lp_params(lp_draw_max: u64, lp_draw_interval: i64) -> Result<()> {
    require!(lp_draw_max <= LP_DRAW_MAX_CAP, VaultError::LpDrawMaxTooHigh);
    require!(lp_draw_interval >= MIN_LP_DRAW_INTERVAL, VaultError::LpDrawIntervalTooShort);
    Ok(())
}

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    validate_split(&args.split)?;
    validate_lp_params(args.lp_draw_max, args.lp_draw_interval)?;
    require!(args.creator_fee_bps >= 1 && args.creator_fee_bps <= MAX_CREATOR_FEE_BPS, VaultError::CreatorFeeOutOfRange);

    let c = &mut ctx.accounts.config;
    c.admin = args.admin;
    c.treasury = args.treasury;
    c.buyback_wallet = args.buyback_wallet;
    c.rewards_wallet = args.rewards_wallet;
    c.lp_wallet = args.lp_wallet;
    c.quote_mint = ctx.accounts.quote_mint.key();
    c.quote_decimals = ctx.accounts.quote_mint.decimals;
    c.split = args.split;
    c.lp_draw_max = args.lp_draw_max;
    c.lp_draw_interval = args.lp_draw_interval;
    c.last_lp_draw_ts = 0;
    c.creator_fee_bps = args.creator_fee_bps;
    c.paused = false;
    c.launch_fee_lamports = args.launch_fee_lamports;
    c.satpad_mint = Pubkey::default();
    c.satpad_pool = Pubkey::default();
    c.satpad_lp_mint = Pubkey::default();
    c.bump = ctx.bumps.config;
    c.lp_pot_bump = ctx.bumps.lp_pot;

    emit!(Initialized {
        admin: c.admin,
        quote_mint: c.quote_mint,
        quote_decimals: c.quote_decimals,
        split: c.split,
        creator_fee_bps: c.creator_fee_bps,
        lp_draw_max: c.lp_draw_max,
        lp_draw_interval: c.lp_draw_interval,
    });
    Ok(())
}

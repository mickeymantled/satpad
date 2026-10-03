use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::LpDrawn;
use crate::instructions::payee::pay_from_pot;
use crate::state::Config;

#[derive(Accounts)]
pub struct DrawLp<'info> {
    /// Only `Config.lp_wallet`.
    #[account(address = config.lp_wallet @ VaultError::NotLpWallet)]
    pub lp_wallet: Signer<'info>,

    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [SEED_LP_POT], bump = config.lp_pot_bump)]
    pub lp_pot: InterfaceAccount<'info, TokenAccount>,

    /// `ATA(Config.lp_wallet, quote)` — the only possible destination.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = config.lp_wallet,
        associated_token::token_program = quote_token_program,
    )]
    pub lp_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_draw_lp<'info>(ctx: Context<'info, DrawLp<'info>>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let config = &ctx.accounts.config;
    require!(amount > 0, VaultError::ZeroAmount);
    require!(amount <= config.lp_draw_max, VaultError::LpDrawTooLarge);
    require!(
        config.last_lp_draw_ts == 0 || clock.unix_timestamp.saturating_sub(config.last_lp_draw_ts) >= config.lp_draw_interval,
        VaultError::LpDrawTooSoon
    );

    pay_from_pot(&ctx.accounts.config, &ctx.accounts.lp_pot, &ctx.accounts.lp_ata, &ctx.accounts.quote_mint, &ctx.accounts.quote_token_program, amount)?;
    ctx.accounts.config.last_lp_draw_ts = clock.unix_timestamp;

    let remaining = ctx.accounts.lp_pot.amount.checked_sub(amount).ok_or(VaultError::Overflow)?;
    emit!(LpDrawn { amount, timestamp: clock.unix_timestamp, lp_pot_remaining: remaining });
    Ok(())
}

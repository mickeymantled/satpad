//! Admin (hot key) and upgrade-authority instructions. SPEC "Authorities": the admin can pause, change the split
//! within bounds, change treasury/buyback/rewards wallets and recover a paused coin to the fixed address. It cannot
//! upgrade, touch `LpPot`, change a payee, or set LP params.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::{LpParamsSet, Paused, Recovered, SplitChanged, WalletsChanged};
use crate::instructions::initialize::{validate_lp_params, validate_split};
use crate::state::{Coin, Config, Split};

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    #[account(address = config.admin @ VaultError::NotAdmin)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn handle_set_split(ctx: Context<AdminConfig>, split: Split) -> Result<()> {
    validate_split(&split)?;
    let config = &mut ctx.accounts.config;
    let old = config.split;
    config.split = split;
    emit!(SplitChanged { old, new: split });
    Ok(())
}

pub fn handle_set_wallets(ctx: Context<AdminConfig>, treasury: Option<Pubkey>, buyback_wallet: Option<Pubkey>, rewards_wallet: Option<Pubkey>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    for w in [treasury, buyback_wallet, rewards_wallet].into_iter().flatten() {
        require!(w != Pubkey::default(), VaultError::InvalidWallet);
    }
    if let Some(t) = treasury {
        config.treasury = t;
    }
    if let Some(b) = buyback_wallet {
        config.buyback_wallet = b;
    }
    if let Some(r) = rewards_wallet {
        config.rewards_wallet = r;
    }
    emit!(WalletsChanged { treasury: config.treasury, buyback_wallet: config.buyback_wallet, rewards_wallet: config.rewards_wallet });
    Ok(())
}

pub fn handle_set_pause(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(Paused { mint: Pubkey::default(), paused });
    Ok(())
}

#[derive(Accounts)]
pub struct AdminCoin<'info> {
    #[account(address = config.admin @ VaultError::NotAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: seed only; `coin.has_one = mint`.
    pub mint: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint)]
    pub coin: Account<'info, Coin>,
}

pub fn handle_set_coin_pause(ctx: Context<AdminCoin>, paused: bool) -> Result<()> {
    ctx.accounts.coin.paused = paused;
    emit!(Paused { mint: ctx.accounts.coin.mint, paused });
    Ok(())
}

#[derive(Accounts)]
pub struct Recover<'info> {
    #[account(address = config.admin @ VaultError::NotAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: seed only; `coin.has_one = mint`.
    pub mint: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint,
        constraint = coin.paused @ VaultError::CoinNotPaused,
    )]
    pub coin: Account<'info, Coin>,
    /// CHECK: PDA authority over `coin_fee_ata`.
    #[account(seeds = [SEED_COIN_FEE, mint.key().as_ref()], bump = coin.coin_fee_bump)]
    pub coin_fee: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = coin_fee,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_fee_ata: InterfaceAccount<'info, TokenAccount>,
    /// `ATA(RECOVERY_ADDRESS, quote)` — the only possible destination. The admin creates it beforehand.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = RECOVERY_ADDRESS,
        associated_token::token_program = quote_token_program,
    )]
    pub recovery_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_recover<'info>(ctx: Context<'info, Recover<'info>>) -> Result<()> {
    let amount = ctx.accounts.coin_fee_ata.amount;
    if amount > 0 {
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[SEED_COIN_FEE, mint_key.as_ref(), &[ctx.accounts.coin.coin_fee_bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.coin_fee_ata.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.recovery_ata.to_account_info(),
                    authority: ctx.accounts.coin_fee.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
    }
    emit!(Recovered { mint: ctx.accounts.coin.mint, amount, destination: ctx.accounts.recovery_ata.key() });
    Ok(())
}

/// Signed by the program's upgrade authority: on mainnet the Squads vault, never the admin.
#[derive(Accounts)]
pub struct SetLp<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ VaultError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::SatpadVault>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ VaultError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
}

pub fn handle_set_lp(ctx: Context<SetLp>, lp_wallet: Option<Pubkey>, lp_draw_max: Option<u64>, lp_draw_interval: Option<i64>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let new_max = lp_draw_max.unwrap_or(config.lp_draw_max);
    let new_interval = lp_draw_interval.unwrap_or(config.lp_draw_interval);
    validate_lp_params(new_max, new_interval)?;
    if let Some(w) = lp_wallet {
        require!(w != Pubkey::default(), VaultError::InvalidWallet);
        config.lp_wallet = w;
    }
    config.lp_draw_max = new_max;
    config.lp_draw_interval = new_interval;
    emit!(LpParamsSet { lp_wallet: config.lp_wallet, lp_draw_max: new_max, lp_draw_interval: new_interval });
    Ok(())
}

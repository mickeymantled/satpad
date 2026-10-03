use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::{HolderRewardsSet, PayeePaid, PayeeRedirected};
use crate::state::{Coin, Config, PayeeMode};

/// Moves `amount` from a Config-owned pot to `to`, signed by the Config PDA.
pub fn pay_from_pot<'info>(
    config: &Account<'info, Config>,
    pot: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    quote_mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[SEED_CONFIG, &[config.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: pot.to_account_info(),
                mint: quote_mint.to_account_info(),
                to: to.to_account_info(),
                authority: config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        quote_mint.decimals,
    )
}

#[derive(Accounts)]
pub struct PayPayee<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: seed only; `coin.has_one = mint`.
    pub mint: UncheckedAccount<'info>,

    /// Checked before `payee_ata` so a Holders-mode coin fails with `HoldersMode`, not an ATA mismatch.
    #[account(
        seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint,
        constraint = coin.payee_mode == PayeeMode::Wallet @ VaultError::HoldersMode,
    )]
    pub coin: Account<'info, Coin>,

    #[account(mut, seeds = [SEED_PAYEE_POT, mint.key().as_ref()], bump = coin.payee_pot_bump)]
    pub payee_pot: InterfaceAccount<'info, TokenAccount>,

    /// `ATA(coin.payee, quote)`. Must already exist: the vault never pays rent for a payee's ATA (SPEC "Payouts").
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = coin.payee,
        associated_token::token_program = quote_token_program,
    )]
    pub payee_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_pay_payee<'info>(ctx: Context<'info, PayPayee<'info>>) -> Result<()> {
    let coin = &ctx.accounts.coin;
    let amount = ctx.accounts.payee_pot.amount;
    pay_from_pot(&ctx.accounts.config, &ctx.accounts.payee_pot, &ctx.accounts.payee_ata, &ctx.accounts.quote_mint, &ctx.accounts.quote_token_program, amount)?;
    if amount > 0 {
        emit!(PayeePaid { mint: coin.mint, payee: coin.payee, amount });
    }
    Ok(())
}

/// Shared by `redirect_payee` and `set_holder_rewards`: the current payee signs and is paid out first.
#[derive(Accounts)]
pub struct ChangePayee<'info> {
    /// The current payee. Nobody else — not the deployer, not the admin — can call this.
    #[account(address = coin.payee @ VaultError::NotPayee)]
    pub payee: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: seed only; `coin.has_one = mint`.
    pub mint: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint)]
    pub coin: Account<'info, Coin>,

    #[account(mut, seeds = [SEED_PAYEE_POT, mint.key().as_ref()], bump = coin.payee_pot_bump)]
    pub payee_pot: InterfaceAccount<'info, TokenAccount>,

    /// The old payee's quote ATA, paid in the same instruction so a change can never be blocked by a withheld payout.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = payee,
        associated_token::token_program = quote_token_program,
    )]
    pub payee_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

fn settle_old_payee<'info>(ctx: &Context<'info, ChangePayee<'info>>) -> Result<u64> {
    require!(ctx.accounts.coin.payee_mode == PayeeMode::Wallet, VaultError::HoldersMode);
    let amount = ctx.accounts.payee_pot.amount;
    pay_from_pot(&ctx.accounts.config, &ctx.accounts.payee_pot, &ctx.accounts.payee_ata, &ctx.accounts.quote_mint, &ctx.accounts.quote_token_program, amount)?;
    Ok(amount)
}

pub fn handle_redirect_payee<'info>(ctx: Context<'info, ChangePayee<'info>>, new_payee: Pubkey) -> Result<()> {
    require!(new_payee != Pubkey::default() && new_payee != ctx.accounts.coin.payee, VaultError::InvalidPayee);
    let paid_out = settle_old_payee(&ctx)?;
    let coin = &mut ctx.accounts.coin;
    let old_payee = coin.payee;
    coin.payee = new_payee;
    emit!(PayeeRedirected { mint: coin.mint, old_payee, new_payee, paid_out });
    Ok(())
}

pub fn handle_set_holder_rewards<'info>(ctx: Context<'info, ChangePayee<'info>>) -> Result<()> {
    let paid_out = settle_old_payee(&ctx)?;
    let coin = &mut ctx.accounts.coin;
    let old_payee = coin.payee;
    coin.payee = Pubkey::default();
    coin.payee_mode = PayeeMode::Holders;
    emit!(HolderRewardsSet { mint: coin.mint, old_payee, paid_out });
    Ok(())
}

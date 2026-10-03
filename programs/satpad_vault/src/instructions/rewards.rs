use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::RewardsReleased;
use crate::instructions::payee::pay_from_pot;
use crate::state::{Coin, Config, PayeeMode, RewardsRun};

#[derive(Accounts)]
pub struct ReleaseRewards<'info> {
    /// Only `Config.rewards_wallet`. Pays rent for the `RewardsRun` record.
    #[account(mut, address = config.rewards_wallet @ VaultError::NotRewardsWallet)]
    pub rewards_wallet: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: seed only; `coin.has_one = mint`.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut, seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint,
        constraint = coin.payee_mode == PayeeMode::Holders @ VaultError::NotHoldersMode,
    )]
    pub coin: Account<'info, Coin>,

    /// Written before the pot moves; `init` with `run_index = coin.rewards_run_count` makes each run unique.
    #[account(
        init, payer = rewards_wallet, space = 8 + RewardsRun::INIT_SPACE,
        seeds = [SEED_REWARDS_RUN, mint.key().as_ref(), &coin.rewards_run_count.to_le_bytes()], bump,
    )]
    pub rewards_run: Account<'info, RewardsRun>,

    #[account(mut, seeds = [SEED_REWARDS_POT, mint.key().as_ref()], bump = coin.rewards_pot_bump)]
    pub rewards_pot: InterfaceAccount<'info, TokenAccount>,

    /// `ATA(Config.rewards_wallet, quote)` — the only possible destination.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = config.rewards_wallet,
        associated_token::token_program = quote_token_program,
    )]
    pub rewards_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_release_rewards<'info>(ctx: Context<'info, ReleaseRewards<'info>>, snapshot_sha256: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;
    let coin = &ctx.accounts.coin;
    let amount = ctx.accounts.rewards_pot.amount;
    require!(amount >= REWARDS_MIN_RELEASE, VaultError::RewardsPotBelowMin);
    require!(
        coin.rewards_run_count == 0 || clock.unix_timestamp.saturating_sub(coin.last_rewards_run_ts) >= REWARDS_RUN_MIN_INTERVAL,
        VaultError::RewardsTooSoon
    );

    let run = &mut ctx.accounts.rewards_run;
    run.mint = coin.mint;
    run.run_index = coin.rewards_run_count;
    run.snapshot_sha256 = snapshot_sha256;
    run.slot = clock.slot;
    run.amount_released = amount;
    run.timestamp = clock.unix_timestamp;
    run.bump = ctx.bumps.rewards_run;

    pay_from_pot(&ctx.accounts.config, &ctx.accounts.rewards_pot, &ctx.accounts.rewards_ata, &ctx.accounts.quote_mint, &ctx.accounts.quote_token_program, amount)?;

    let coin = &mut ctx.accounts.coin;
    coin.last_rewards_run_ts = clock.unix_timestamp;
    coin.rewards_run_count = coin.rewards_run_count.checked_add(1).ok_or(VaultError::Overflow)?;

    emit!(RewardsReleased { mint: coin.mint, run_index: coin.rewards_run_count - 1, snapshot_sha256, amount, slot: clock.slot, timestamp: clock.unix_timestamp });
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::Declared;
use crate::pump::{self, BondingCurve};
use crate::state::{Coin, Config, PayeeChoice, PayeeMode};

#[derive(Accounts)]
pub struct DeclareCoin<'info> {
    /// The launcher. Pays rent and the launch fee.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The new coin's mint keypair. Signing proves this runs in the launch transaction.
    pub mint: Signer<'info>,

    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: receives the launch fee; must be `Config.treasury`.
    #[account(mut, address = config.treasury @ VaultError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: pump.fun's curve for `mint`. PDA under the pump program and owned by it; contents parsed in the handler.
    #[account(
        seeds = [pump::BONDING_CURVE_SEED, mint.key().as_ref()], bump, seeds::program = pump::PUMP_PROGRAM_ID,
        owner = pump::PUMP_PROGRAM_ID @ VaultError::BadCurveData,
    )]
    pub bonding_curve: UncheckedAccount<'info>,

    /// `init` makes a second declaration fail.
    #[account(init, payer = user, space = 8 + Coin::INIT_SPACE, seeds = [SEED_COIN, mint.key().as_ref()], bump)]
    pub coin: Account<'info, Coin>,

    /// CHECK: PDA authority that pump.fun knows as the coin's `creator`. Holds no data.
    #[account(seeds = [SEED_COIN_FEE, mint.key().as_ref()], bump)]
    pub coin_fee: UncheckedAccount<'info>,

    /// `ATA(coin_fee, quote_mint)`: where pump.fun's permissionless collect pays the creator fee (VERIFIED V4).
    /// Created here because neither pump program creates it.
    #[account(
        init, payer = user,
        associated_token::mint = quote_mint, associated_token::authority = coin_fee,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_fee_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init, payer = user, seeds = [SEED_PAYEE_POT, mint.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = config, token::token_program = quote_token_program,
    )]
    pub payee_pot: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init, payer = user, seeds = [SEED_REWARDS_POT, mint.key().as_ref()], bump,
        token::mint = quote_mint, token::authority = config, token::token_program = quote_token_program,
    )]
    pub rewards_pot: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_declare_coin(ctx: Context<DeclareCoin>, payee: PayeeChoice, treasury_only: bool) -> Result<()> {
    let config = &ctx.accounts.config;

    // The curve must point every creator fee at our PDA, in our quote, at exactly the configured rate (D9).
    let curve = BondingCurve::parse(&ctx.accounts.bonding_curve.try_borrow_data()?)?;
    require_keys_eq!(curve.creator, ctx.accounts.coin_fee.key(), VaultError::WrongCurveCreator);
    require_keys_eq!(curve.quote_mint, config.quote_mint, VaultError::WrongCurveQuoteMint);
    require!(curve.creator_fee_bps == config.creator_fee_bps as u64, VaultError::CreatorFeeMismatch);
    require!(!curve.is_holder_reward, VaultError::HolderRewardCurve);
    require!(!curve.is_mayhem_mode, VaultError::MayhemCurve);

    // Only the admin may flag a treasury-only coin ($SATPAD).
    if treasury_only {
        require_keys_eq!(ctx.accounts.user.key(), config.admin, VaultError::NotAdmin);
    }

    let (payee_key, payee_mode) = match payee {
        PayeeChoice::Me => (ctx.accounts.user.key(), PayeeMode::Wallet),
        PayeeChoice::Wallet(w) => (w, PayeeMode::Wallet),
        PayeeChoice::Holders => (Pubkey::default(), PayeeMode::Holders),
    };

    if config.launch_fee_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer { from: ctx.accounts.user.to_account_info(), to: ctx.accounts.treasury.to_account_info() },
            ),
            config.launch_fee_lamports,
        )?;
    }

    let coin = &mut ctx.accounts.coin;
    coin.mint = ctx.accounts.mint.key();
    coin.deployer = ctx.accounts.user.key();
    coin.payee = payee_key;
    coin.payee_mode = payee_mode;
    coin.paused = false;
    coin.created_at = Clock::get()?.unix_timestamp;
    coin.declared = true;
    coin.treasury_only = treasury_only;
    coin.last_rewards_run_ts = 0;
    coin.rewards_run_count = 0;
    coin.bump = ctx.bumps.coin;
    coin.coin_fee_bump = ctx.bumps.coin_fee;
    coin.payee_pot_bump = ctx.bumps.payee_pot;
    coin.rewards_pot_bump = ctx.bumps.rewards_pot;

    emit!(Declared {
        mint: coin.mint,
        deployer: coin.deployer,
        payee: coin.payee,
        payee_mode: coin.payee_mode,
        treasury_only,
        creator_fee_bps: config.creator_fee_bps,
        launch_fee_lamports: config.launch_fee_lamports,
    });
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::consts::*;
use crate::errors::VaultError;
use crate::events::Settled;
use crate::state::{Coin, Config, PayeeMode, Split};

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: only used as a seed; `coin` ties it to the registration.
    pub mint: UncheckedAccount<'info>,

    #[account(seeds = [SEED_COIN, mint.key().as_ref()], bump = coin.bump, has_one = mint)]
    pub coin: Account<'info, Coin>,

    /// CHECK: PDA authority over `coin_fee_ata`; signs the transfers out.
    #[account(seeds = [SEED_COIN_FEE, mint.key().as_ref()], bump = coin.coin_fee_bump)]
    pub coin_fee: UncheckedAccount<'info>,

    /// Where pump.fun's collect paid the creator fee.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = coin_fee,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_fee_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_LP_POT], bump = config.lp_pot_bump)]
    pub lp_pot: InterfaceAccount<'info, TokenAccount>,

    /// `ATA(Config.buyback_wallet, quote)`. Must already exist; the vault never pays rent for a wallet's ATA.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = config.buyback_wallet,
        associated_token::token_program = quote_token_program,
    )]
    pub buyback_ata: InterfaceAccount<'info, TokenAccount>,

    /// `ATA(Config.treasury, quote)`.
    #[account(
        mut,
        associated_token::mint = quote_mint, associated_token::authority = config.treasury,
        associated_token::token_program = quote_token_program,
    )]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_PAYEE_POT, mint.key().as_ref()], bump = coin.payee_pot_bump)]
    pub payee_pot: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_REWARDS_POT, mint.key().as_ref()], bump = coin.rewards_pot_bump)]
    pub rewards_pot: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.quote_mint @ VaultError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,

    pub quote_token_program: Interface<'info, TokenInterface>,
}

/// `amount * bps / 10000`, floored, via u128. Never overflows for u64 amounts.
pub fn share(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(VaultError::Overflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(v).map_err(|_| error!(VaultError::Overflow))
}

/// Four-way split. Buyback, operator and deployer are floored; liquidity takes the remainder so it never falls below
/// its bps floor (DECISIONS D7). Returns (liquidity, buyback, operator, deployer); the four always sum to `amount`.
pub fn split_amount(amount: u64, s: &Split) -> Result<(u64, u64, u64, u64)> {
    let buyback = share(amount, s.buyback_bps)?;
    let operator = share(amount, s.operator_bps)?;
    let deployer = share(amount, s.deployer_bps)?;
    let liquidity = amount
        .checked_sub(buyback)
        .and_then(|v| v.checked_sub(operator))
        .and_then(|v| v.checked_sub(deployer))
        .ok_or(VaultError::Overflow)?;
    Ok((liquidity, buyback, operator, deployer))
}

pub fn handle_settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
    let config = &ctx.accounts.config;
    let coin = &ctx.accounts.coin;
    require!(!config.paused, VaultError::Paused);
    require!(!coin.paused, VaultError::CoinPaused);

    let amount = ctx.accounts.coin_fee_ata.amount;
    if amount == 0 {
        return Ok(());
    }

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[SEED_COIN_FEE, mint_key.as_ref(), &[coin.coin_fee_bump]];
    let signer: &[&[&[u8]]] = &[seeds];
    let decimals = ctx.accounts.quote_mint.decimals;

    let transfer = |to: &InterfaceAccount<'info, TokenAccount>, amt: u64| -> Result<()> {
        if amt == 0 {
            return Ok(());
        }
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.coin_fee_ata.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: ctx.accounts.coin_fee.to_account_info(),
                },
                signer,
            ),
            amt,
            decimals,
        )
    };

    let (liquidity, buyback, operator, deployer, deployer_destination) = if coin.treasury_only {
        // $SATPAD: everything to the treasury (SPEC "Fee split", last paragraph).
        transfer(&ctx.accounts.treasury_ata, amount)?;
        (0, 0, amount, 0, ctx.accounts.treasury_ata.key())
    } else {
        let (liquidity, buyback, operator, deployer) = split_amount(amount, &config.split)?;
        transfer(&ctx.accounts.lp_pot, liquidity)?;
        transfer(&ctx.accounts.buyback_ata, buyback)?;
        transfer(&ctx.accounts.treasury_ata, operator)?;
        let dest = match coin.payee_mode {
            PayeeMode::Wallet => &ctx.accounts.payee_pot,
            PayeeMode::Holders => &ctx.accounts.rewards_pot,
        };
        transfer(dest, deployer)?;
        (liquidity, buyback, operator, deployer, dest.key())
    };

    emit!(Settled { mint: mint_key, amount, liquidity, buyback, operator, deployer, deployer_destination, split: config.split });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const S: Split = Split { liquidity_bps: 2500, buyback_bps: 2500, operator_bps: 1000, deployer_bps: 4000 };

    #[test]
    fn parts_sum_and_liquidity_floor_holds() {
        for amount in [0u64, 1, 2, 3, 7, 9_999, 10_000, 10_001, 123_456_789, u64::MAX - 1, u64::MAX] {
            let (l, b, o, d) = split_amount(amount, &S).unwrap();
            assert_eq!(l as u128 + b as u128 + o as u128 + d as u128, amount as u128);
            assert!(l >= share(amount, S.liquidity_bps).unwrap());
            assert_eq!(b, share(amount, S.buyback_bps).unwrap());
            assert_eq!(o, share(amount, S.operator_bps).unwrap());
            assert_eq!(d, share(amount, S.deployer_bps).unwrap());
        }
        assert_eq!(split_amount(1, &S).unwrap(), (1, 0, 0, 0));
        assert_eq!(split_amount(3, &S).unwrap(), (2, 0, 0, 1));
        assert_eq!(split_amount(10_000, &S).unwrap(), (2_500, 2_500, 1_000, 4_000));
    }

    #[test]
    fn max_bounds_do_not_overflow() {
        assert_eq!(share(u64::MAX, 10_000).unwrap(), u64::MAX);
        let edge = Split { liquidity_bps: 2500, buyback_bps: 2500, operator_bps: 2000, deployer_bps: 3000 };
        let (l, b, o, d) = split_amount(u64::MAX, &edge).unwrap();
        assert_eq!(l as u128 + b as u128 + o as u128 + d as u128, u64::MAX as u128);
    }
}

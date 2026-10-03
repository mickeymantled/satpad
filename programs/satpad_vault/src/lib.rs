//! satpad_vault — the only custom on-chain code in Satpad. Receives each coin's pump.fun creator fee in BTC and
//! splits it by a config the admin can tune only within hard bounds. SPEC.md "satpad_vault program".
pub mod consts;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod pump;
pub mod state;

use anchor_lang::prelude::*;

pub use consts::*;
pub use instructions::*;
pub use state::*;

declare_id!("52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93");

#[program]
pub mod satpad_vault {
    use super::*;

    /// Creates `Config` and `LpPot`. Once.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    /// Registers a pump.fun coin whose creator is this program's `CoinFee` PDA. Signed by the launcher and the new
    /// mint keypair, so only the launch transaction can write the payee choice, once. Collects the launch fee.
    pub fn declare_coin(ctx: Context<DeclareCoin>, payee: PayeeChoice, treasury_only: bool) -> Result<()> {
        instructions::declare_coin::handle_declare_coin(ctx, payee, treasury_only)
    }

    /// Splits whatever sits in the coin's `CoinFee` ATA by the current `Config.split`. Anyone can call.
    pub fn settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
        instructions::settle::handle_settle(ctx)
    }

    /// Transfers the whole `PayeePot` to the current payee's quote ATA. Anyone can call; never creates the ATA.
    pub fn pay_payee<'info>(ctx: Context<'info, PayPayee<'info>>) -> Result<()> {
        instructions::payee::handle_pay_payee(ctx)
    }

    /// Current payee hands the deployer share to `new_payee`, receiving whatever is waiting first. Irreversible.
    pub fn redirect_payee<'info>(ctx: Context<'info, ChangePayee<'info>>, new_payee: Pubkey) -> Result<()> {
        instructions::payee::handle_redirect_payee(ctx, new_payee)
    }

    /// Current payee makes the deployer share pay holders forever, receiving whatever is waiting first.
    pub fn set_holder_rewards<'info>(ctx: Context<'info, ChangePayee<'info>>) -> Result<()> {
        instructions::payee::handle_set_holder_rewards(ctx)
    }
}

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
}

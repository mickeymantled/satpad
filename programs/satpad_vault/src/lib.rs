//! satpad_vault — the only custom on-chain code in Satpad. Receives each coin's pump.fun creator fee in BTC and
//! splits it by a config the admin can tune only within hard bounds. SPEC.md "satpad_vault program".
pub mod consts;
pub mod errors;
pub mod events;
pub mod instructions;
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
}

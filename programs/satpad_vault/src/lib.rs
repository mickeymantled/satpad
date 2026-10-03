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

    /// Rewards wallet moves a Holders-mode coin's `RewardsPot` out for one run, after writing the snapshot hash.
    /// At most once per `REWARDS_RUN_MIN_INTERVAL` per coin.
    pub fn release_rewards<'info>(ctx: Context<'info, ReleaseRewards<'info>>, snapshot_sha256: [u8; 32]) -> Result<()> {
        instructions::rewards::handle_release_rewards(ctx, snapshot_sha256)
    }

    /// LP wallet draws up to `Config.lp_draw_max` from `LpPot`, at least `Config.lp_draw_interval` after the last draw.
    /// The only instruction that moves BTC out of `LpPot`.
    pub fn draw_lp<'info>(ctx: Context<'info, DrawLp<'info>>, amount: u64) -> Result<()> {
        instructions::lp::handle_draw_lp(ctx, amount)
    }

    // ---- admin (hot key, bounded) ----

    /// Changes the split within the program bounds. Applies to every later `settle`.
    pub fn set_split(ctx: Context<AdminConfig>, split: Split) -> Result<()> {
        instructions::admin::handle_set_split(ctx, split)
    }

    /// Changes treasury, buyback and rewards wallets. Never the recovery address (a constant) or the LP wallet.
    pub fn set_wallets(ctx: Context<AdminConfig>, treasury: Option<Pubkey>, buyback_wallet: Option<Pubkey>, rewards_wallet: Option<Pubkey>) -> Result<()> {
        instructions::admin::handle_set_wallets(ctx, treasury, buyback_wallet, rewards_wallet)
    }

    /// Pauses or unpauses every coin's `settle`.
    pub fn set_pause(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_pause(ctx, paused)
    }

    /// Pauses or unpauses one coin's `settle`.
    pub fn set_coin_pause(ctx: Context<AdminCoin>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_coin_pause(ctx, paused)
    }

    /// Only while a coin is paused: moves its `CoinFee` balance to the fixed `RECOVERY_ADDRESS`.
    pub fn recover<'info>(ctx: Context<'info, Recover<'info>>) -> Result<()> {
        instructions::admin::handle_recover(ctx)
    }

    // ---- upgrade authority (Squads multisig on mainnet) ----

    /// Sets the LP wallet and draw limits within the program caps.
    pub fn set_lp(ctx: Context<SetLp>, lp_wallet: Option<Pubkey>, lp_draw_max: Option<u64>, lp_draw_interval: Option<i64>) -> Result<()> {
        instructions::admin::handle_set_lp(ctx, lp_wallet, lp_draw_max, lp_draw_interval)
    }
}

//! Every hard bound the program enforces, in one place. Changing any value here is a program upgrade through the
//! Squads multisig. SPEC.md "Bounds the program enforces"; DECISIONS D3, D7, D9.
use anchor_lang::prelude::*;

/// Liquidity share of the creator fee never below this (0.25% of trade at a 1% creator fee).
pub const MIN_LIQUIDITY_BPS: u16 = 2500;
/// Operator share never above this.
pub const MAX_OPERATOR_BPS: u16 = 2000;
/// Four shares must sum to this.
pub const BPS_DENOMINATOR: u16 = 10_000;

/// Creator fee every registered coin must pass to pump.fun `create_v2` (DECISIONS D3): the top of pump.fun's
/// published Custom Pairs range. `Config.creator_fee_bps` may be set anywhere in 1..=this.
pub const MAX_CREATOR_FEE_BPS: u16 = 100;

/// Cap on `Config.lp_draw_max`, in quote base units (sats): 0.005 BTC per draw (DECISIONS D9). At $100k/BTC that is
/// ~$500 per draw, ≤ 0.1% of a $500k pool per 5-minute interval, so a stolen LP key moves at most ~$144k/day
/// and every draw is visible on the Ledger before the next one is allowed.
pub const LP_DRAW_MAX_CAP: u64 = 500_000;
/// `Config.lp_draw_interval` never below this many seconds.
pub const MIN_LP_DRAW_INTERVAL: i64 = 300;
/// `release_rewards` at most once per this many seconds per coin.
pub const REWARDS_RUN_MIN_INTERVAL: i64 = 3600;

/// Where `recover` sends a paused coin's `CoinFee` balance. A constant, never a Config field, so no key can redirect
/// it. The `mainnet` cargo feature selects the Squads vault address; the default is the fork/dev keypair in keys/.
#[cfg(feature = "mainnet")]
pub const RECOVERY_ADDRESS: Pubkey = pubkey!("11111111111111111111111111111111"); // TODO M10: Squads vault; build refuses until set
#[cfg(not(feature = "mainnet"))]
pub const RECOVERY_ADDRESS: Pubkey = pubkey!("CTsAbZqVBmfb2NgUr8BJ9CUCmj1vMqrR3kWA8k6Wcmog"); // keys/recovery-dev.json

/// Dev keys that must never appear as a mainnet constant (DECISIONS D9).
pub const DEV_KEYS: [Pubkey; 2] = [
    pubkey!("CTsAbZqVBmfb2NgUr8BJ9CUCmj1vMqrR3kWA8k6Wcmog"), // keys/recovery-dev.json
    pubkey!("52Kj3EZg6Cr7jeLd5bmVtVwe7kPqWHsLvR6UoCiZ4H93"), // keys/satpad_vault-dev.json (program id)
];

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_COIN_FEE: &[u8] = b"coin_fee";
pub const SEED_COIN: &[u8] = b"coin";
pub const SEED_PAYEE_POT: &[u8] = b"payee_pot";
pub const SEED_REWARDS_POT: &[u8] = b"rewards_pot";
pub const SEED_LP_POT: &[u8] = b"lp_pot";
pub const SEED_REWARDS_RUN: &[u8] = b"rewards_run";

#[cfg(all(test, feature = "mainnet"))]
mod mainnet_guard {
    use super::*;
    /// A mainnet build must carry a real recovery address: not a dev key and not the system program.
    #[test]
    fn recovery_address_is_not_a_dev_or_placeholder_key() {
        assert!(!DEV_KEYS.contains(&RECOVERY_ADDRESS), "mainnet RECOVERY_ADDRESS is a dev key");
        assert_ne!(RECOVERY_ADDRESS, Pubkey::default(), "mainnet RECOVERY_ADDRESS not set");
    }
}

#[cfg(test)]
mod bounds {
    use super::*;
    #[test]
    fn bounds_are_consistent() {
        assert!(MIN_LIQUIDITY_BPS + MAX_OPERATOR_BPS <= BPS_DENOMINATOR);
        assert!(MAX_CREATOR_FEE_BPS >= 1 && MAX_CREATOR_FEE_BPS <= BPS_DENOMINATOR);
        assert!(MIN_LP_DRAW_INTERVAL > 0 && REWARDS_RUN_MIN_INTERVAL > 0);
    }
}

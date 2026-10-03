//! Minimal repro for VERIFIED V14 / DECISIONS D11. Not deployed anywhere.
//! `init_rec` creates `Rec { mint, bump }` at PDA ["rec", mint]. Each `check_*` reads it back under a different
//! constraint combination. Under SBPF v2 all pass; under v3 some fail with a Pubkey corrupted past byte 8.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

declare_id!("7JLG4yR2ohNn21SSXf7eiPCnWfqiMtMPoUaDQuTDphuW");

#[account]
#[derive(InitSpace)]
pub struct Rec {
    pub mint: Pubkey,
    pub bump: u8,
}

#[program]
pub mod sbpf_repro {
    use super::*;

    pub fn init_rec(ctx: Context<InitRec>) -> Result<()> {
        ctx.accounts.rec.mint = ctx.accounts.mint.key();
        ctx.accounts.rec.bump = ctx.bumps.rec;
        Ok(())
    }
    /// seeds (stored bump) + has_one, UncheckedAccount key via .key() — the satpad_vault settle shape.
    pub fn check_seeds_has_one(_ctx: Context<CheckSeedsHasOne>) -> Result<()> { Ok(()) }
    /// has_one only.
    pub fn check_has_one(_ctx: Context<CheckHasOne>) -> Result<()> { Ok(()) }
    /// seeds (stored bump) only.
    pub fn check_seeds(_ctx: Context<CheckSeeds>) -> Result<()> { Ok(()) }
    /// seeds with canonical bump search only.
    pub fn check_seeds_find(_ctx: Context<CheckSeedsFind>) -> Result<()> { Ok(()) }
    /// Same as check_seeds_has_one but the mint is a Signer (the declare_coin shape, which works on v3).
    pub fn check_signer(_ctx: Context<CheckSigner>) -> Result<()> { Ok(()) }
    /// settle shape + 10 extra UncheckedAccounts (wide frame, cheap types).
    pub fn check_many_unchecked(_ctx: Context<CheckManyUnchecked>) -> Result<()> { Ok(()) }
    /// settle shape + 6 InterfaceAccount<TokenAccount> with associated_token constraints (wide frame, heavy types).
    pub fn check_many_token(_ctx: Context<CheckManyToken>) -> Result<()> { Ok(()) }
    /// Manual comparison in the handler, no constraints: isolates codegen vs runtime.
    pub fn check_manual(ctx: Context<CheckManual>) -> Result<()> {
        let k = ctx.accounts.mint.key();
        let stored = ctx.accounts.rec.mint;
        msg!("mint.key()={} rec.mint={} eq={}", k, stored, k == stored);
        require_keys_eq!(k, stored);
        let (pda, _) = Pubkey::find_program_address(&[b"rec", k.as_ref()], ctx.program_id);
        msg!("derived={} actual={}", pda, ctx.accounts.rec.key());
        require_keys_eq!(pda, ctx.accounts.rec.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitRec<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + Rec::INIT_SPACE, seeds = [b"rec", mint.key().as_ref()], bump)]
    pub rec: Account<'info, Rec>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckSeedsHasOne<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump = rec.bump, has_one = mint)]
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckHasOne<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(has_one = mint)]
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckSeeds<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump = rec.bump)]
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckSeedsFind<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump)]
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckSigner<'info> {
    pub mint: Signer<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump = rec.bump, has_one = mint)]
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckManual<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    pub rec: Account<'info, Rec>,
}

#[derive(Accounts)]
pub struct CheckManyUnchecked<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump = rec.bump, has_one = mint)]
    pub rec: Account<'info, Rec>,
    /// CHECK: filler
    pub a0: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a1: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a2: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a3: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a4: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a5: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a6: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a7: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a8: UncheckedAccount<'info>,
    /// CHECK: filler
    pub a9: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CheckManyToken<'info> {
    /// CHECK: seed only
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [b"rec", mint.key().as_ref()], bump = rec.bump, has_one = mint)]
    pub rec: Account<'info, Rec>,
    /// CHECK: ATA owner used in constraints
    pub owner0: UncheckedAccount<'info>,
    /// CHECK: ATA owner used in constraints
    pub owner1: UncheckedAccount<'info>,
    /// CHECK: ATA owner used in constraints
    pub owner2: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = owner0, associated_token::token_program = token_program)]
    pub t0: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = owner1, associated_token::token_program = token_program)]
    pub t1: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = owner2, associated_token::token_program = token_program)]
    pub t2: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub t3: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub t4: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub t5: InterfaceAccount<'info, TokenAccount>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

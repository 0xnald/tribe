use crate::engine::arena as eng;
use crate::errors::TribeError;
use crate::events::*;
use crate::instructions::arena::arena_signer_seeds;
use crate::state::*;
use crate::token::{transfer_from_pda, transfer_from_user};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

fn position_signer_seeds<'a>(p: &'a Position, bump: &'a [u8; 1]) -> [&'a [u8]; 5] {
    [
        POSITION_SEED,
        p.arena.as_ref(),
        std::slice::from_ref(&p.side),
        p.owner.as_ref(),
        bump,
    ]
}

// ───────────────────────────────────────── back

#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Back<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, arena.key().as_ref(), &[side], owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    /// The side's mint — must be the registered asset for `side`.
    #[account(
        constraint = side < 2 @ TribeError::InvalidSide,
        address = arena.assets[side as usize].mint @ TribeError::MintMismatch,
        mint::token_program = asset_token_program,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = asset_mint,
        token::authority = owner,
        token::token_program = asset_token_program,
    )]
    pub owner_asset: InterfaceAccount<'info, TokenAccount>,
    /// Position vault: ATA of the position PDA. Only `owner` can move units out (`exit`).
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = asset_mint,
        associated_token::authority = position,
        associated_token::token_program = asset_token_program,
    )]
    pub position_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        address = arena.assets[side as usize].token_program @ TribeError::TokenProgramMismatch
    )]
    pub asset_token_program: Interface<'info, TokenInterface>,
    // ── fee legs (USDC)
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = usdc_token_program)]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.treasury)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    /// Creator's USDC ATA; required only when the Arena routes the creator share to the creator.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = arena.creator,
        associated_token::token_program = usdc_token_program,
    )]
    pub creator_usdc: Option<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Back `side` with `units` the user already holds. The client composes
/// `[USDC fee legs][Jupiter swap][back]` for USDC entries; this instruction
/// only ever sees units that are already in `owner_asset`, and it verifies the
/// vault delta rather than trusting `units`.
pub fn back(ctx: Context<Back>, side: u8, units: u64, fee_paid: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, TribeError::Paused);
    let t = now()?;
    let arena = &mut ctx.accounts.arena;
    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.arena = arena.key();
        position.side = side;
        position.bump = ctx.bumps.position;
    } else {
        require_keys_eq!(position.owner, ctx.accounts.owner.key(), TribeError::OwnerMismatch);
        require!(position.side == side, TribeError::InvalidSide);
    }
    let out = eng::back(arena, position, side as usize, units, fee_paid, t)?;

    // principal: owner → position vault, verified by vault delta
    let before = ctx.accounts.position_vault.amount;
    transfer_from_user(
        &ctx.accounts.asset_token_program,
        &ctx.accounts.owner_asset,
        &ctx.accounts.position_vault,
        &ctx.accounts.asset_mint,
        &ctx.accounts.owner,
        units,
    )?;
    ctx.accounts.position_vault.reload()?;
    require!(
        ctx.accounts.position_vault.amount == before + units,
        TribeError::DepositMismatch
    );

    // fees: owner USDC → reward vault / treasury / creator
    let s = out.split;
    if s.to_pool > 0 {
        transfer_from_user(
            &ctx.accounts.usdc_token_program,
            &ctx.accounts.owner_usdc,
            &ctx.accounts.reward_vault,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.owner,
            s.to_pool,
        )?;
    }
    if s.to_protocol > 0 {
        transfer_from_user(
            &ctx.accounts.usdc_token_program,
            &ctx.accounts.owner_usdc,
            &ctx.accounts.treasury,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.owner,
            s.to_protocol,
        )?;
    }
    if s.to_creator > 0 {
        let creator_usdc = ctx
            .accounts
            .creator_usdc
            .as_ref()
            .ok_or_else(|| error!(TribeError::InvalidParams))?;
        transfer_from_user(
            &ctx.accounts.usdc_token_program,
            &ctx.accounts.owner_usdc,
            creator_usdc,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.owner,
            s.to_creator,
        )?;
    }
    emit!(Backed {
        arena: arena.key(),
        owner: ctx.accounts.owner.key(),
        side,
        units,
        fee_paid,
        fee_required: out.fee_required,
        multiplier_q4: out.m_q4,
        notional_usdc: out.notional,
    });
    Ok(())
}

// ───────────────────────────────────────── exit

#[derive(Accounts)]
pub struct Exit<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        seeds = [POSITION_SEED, arena.key().as_ref(), &[position.side], owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ TribeError::Unauthorized,
        has_one = arena,
    )]
    pub position: Account<'info, Position>,
    #[account(
        address = arena.assets[position.side as usize].mint @ TribeError::MintMismatch,
        mint::token_program = asset_token_program,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = position,
        associated_token::token_program = asset_token_program,
    )]
    pub position_vault: InterfaceAccount<'info, TokenAccount>,
    /// Destination must be owned by the position owner.
    #[account(mut, token::mint = asset_mint, token::authority = owner, token::token_program = asset_token_program)]
    pub owner_asset: InterfaceAccount<'info, TokenAccount>,
    #[account(
        address = arena.assets[position.side as usize].token_program @ TribeError::TokenProgramMismatch
    )]
    pub asset_token_program: Interface<'info, TokenInterface>,
}

/// Voluntary exit / withdrawal — the only path that moves principal out of a
/// vault, and only to an account owned by the position owner.
pub fn exit(ctx: Context<Exit>, units: u64) -> Result<()> {
    let t = now()?;
    let arena = &mut ctx.accounts.arena;
    let position = &mut ctx.accounts.position;
    let r = eng::exit(arena, position, units, t)?;
    let bump = [position.bump];
    let seeds = position_signer_seeds(position, &bump);
    transfer_from_pda(
        &ctx.accounts.asset_token_program,
        &ctx.accounts.position_vault,
        &ctx.accounts.owner_asset,
        &ctx.accounts.asset_mint,
        position.to_account_info(),
        &[&seeds],
        units,
    )?;
    emit!(Exited {
        arena: arena.key(),
        owner: ctx.accounts.owner.key(),
        side: position.side,
        units,
        forfeited_weight: r.removed_eff_seconds,
    });
    Ok(())
}

// ───────────────────────────────────────── claim

#[derive(Accounts)]
pub struct Claim<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        seeds = [POSITION_SEED, arena.key().as_ref(), &[position.side], owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ TribeError::Unauthorized,
        has_one = arena,
    )]
    pub position: Account<'info, Position>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    /// Reward destination must be owned by the claimant.
    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = usdc_token_program)]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let t = now()?;
    let arena = &mut ctx.accounts.arena;
    let position = &mut ctx.accounts.position;
    // state is updated (claimed = true) before the CPI transfer
    let amount = eng::claim(arena, position, t)?;
    let bump = [arena.bump];
    let seeds = arena_signer_seeds(arena, &bump);
    transfer_from_pda(
        &ctx.accounts.usdc_token_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.owner_usdc,
        &ctx.accounts.usdc_mint,
        arena.to_account_info(),
        &[&seeds],
        amount,
    )?;
    emit!(RewardClaimed {
        arena: arena.key(),
        owner: ctx.accounts.owner.key(),
        side: position.side,
        amount,
    });
    Ok(())
}

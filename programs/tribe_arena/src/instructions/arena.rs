use crate::engine::arena as eng;
use crate::engine::oracle::PriceInput;
use crate::errors::TribeError;
use crate::events::*;
use crate::state::*;
use crate::token::{read_scaled_multiplier_q6, transfer_from_pda, transfer_from_user};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

pub fn arena_signer_seeds<'a>(arena: &'a Arena, bump: &'a [u8; 1]) -> [&'a [u8]; 4] {
    [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le, bump]
}

/// Build a `PriceInput` from a Pyth `PriceUpdateV2` and the side's mint.
pub fn price_input(update: &PriceUpdateV2, mint: &AccountInfo, now: i64) -> Result<PriceInput> {
    let m = &update.price_message;
    Ok(PriceInput {
        feed_id: m.feed_id,
        price: m.price,
        conf: m.conf,
        expo: m.exponent,
        publish_time: m.publish_time,
        fully_verified: update.verification_level == VerificationLevel::Full,
        mult_q6: read_scaled_multiplier_q6(mint, now)?,
    })
}

// ───────────────────────────────────────── create_arena

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateArenaArgs {
    pub nonce: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub allow_closed_settlement: bool,
    pub sponsor_open: bool,
    /// First-party Arenas route the creator share per protocol policy.
    pub first_party: bool,
}

#[derive(Accounts)]
#[instruction(args: CreateArenaArgs)]
pub struct CreateArena<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [ASSET_SEED, asset_a.mint.as_ref()], bump = asset_a.bump)]
    pub asset_a: Box<Account<'info, AssetEntry>>,
    #[account(seeds = [ASSET_SEED, asset_b.mint.as_ref()], bump = asset_b.bump)]
    pub asset_b: Box<Account<'info, AssetEntry>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Arena::INIT_SPACE,
        seeds = [ARENA_SEED, creator.key().as_ref(), &args.nonce.to_le_bytes()],
        bump,
    )]
    pub arena: Box<Account<'info, Arena>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = arena,
        associated_token::token_program = usdc_token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_arena(ctx: Context<CreateArena>, args: CreateArenaArgs) -> Result<()> {
    let cfg = &ctx.accounts.config;
    require!(!cfg.paused, TribeError::Paused);
    let (a, b) = (&ctx.accounts.asset_a, &ctx.accounts.asset_b);
    require!(
        a.status == asset_status::ACTIVE && b.status == asset_status::ACTIVE,
        TribeError::AssetNotActive
    );
    let arena = &mut ctx.accounts.arena;
    arena.creator = ctx.accounts.creator.key();
    arena.nonce = args.nonce;
    arena.nonce_le = args.nonce.to_le_bytes();
    arena.assets = [asset_of(a), asset_of(b)];
    arena.start_ts = args.start_ts;
    arena.end_ts = args.end_ts;
    arena.params = cfg.default_params;
    arena.fee_policy = cfg.fee_policy;
    arena.creator_target = if args.first_party {
        cfg.fee_policy.first_party_creator_target
    } else {
        creator_target::CREATOR
    };
    arena.allow_closed_settlement = args.allow_closed_settlement;
    arena.sponsor_open = args.sponsor_open;
    arena.reward_vault = ctx.accounts.reward_vault.key();
    arena.bump = ctx.bumps.arena;
    eng::validate_creation(arena, now()?, &cfg.limits, 0)?;
    emit!(ArenaCreated {
        arena: arena.key(),
        creator: arena.creator,
        mint_a: arena.assets[0].mint,
        mint_b: arena.assets[1].mint,
        start_ts: arena.start_ts,
        end_ts: arena.end_ts,
        backing_close_ts: arena.backing_close_ts,
    });
    Ok(())
}

fn asset_of(e: &AssetEntry) -> ArenaAsset {
    ArenaAsset {
        mint: e.mint,
        token_program: e.token_program,
        decimals: e.decimals,
        asset_class: e.asset_class,
        feed_id: e.feed_id,
        scaled_ui: e.scaled_ui,
        tolerance_secs: e.tolerance_secs,
        max_closed_staleness_secs: e.max_closed_staleness_secs,
        max_conf_bps: e.max_conf_bps,
    }
}

// ───────────────────────────────────────── fund_reward_pool

#[derive(Accounts)]
pub struct FundRewardPool<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    #[account(
        init_if_needed,
        payer = sponsor,
        space = 8 + Sponsor::INIT_SPACE,
        seeds = [SPONSOR_SEED, arena.key().as_ref(), sponsor.key().as_ref()],
        bump,
    )]
    pub sponsor_record: Box<Account<'info, Sponsor>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = sponsor)]
    pub sponsor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn fund_reward_pool(ctx: Context<FundRewardPool>, amount: u64) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    let sponsor = ctx.accounts.sponsor.key();
    require!(
        arena.sponsor_open || sponsor == arena.creator || sponsor == ctx.accounts.config.authority,
        TribeError::SponsorClosed
    );
    eng::fund_pool(arena, now()?, amount)?;
    let rec = &mut ctx.accounts.sponsor_record;
    rec.arena = arena.key();
    rec.sponsor = sponsor;
    rec.amount = rec
        .amount
        .checked_add(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    rec.refunded = false;
    rec.bump = ctx.bumps.sponsor_record;
    transfer_from_user(
        &ctx.accounts.usdc_token_program,
        &ctx.accounts.sponsor_usdc,
        &ctx.accounts.reward_vault,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.sponsor,
        amount,
    )?;
    emit!(PoolFunded {
        arena: arena.key(),
        sponsor,
        amount
    });
    Ok(())
}

// ───────────────────────────────────────── snapshot_start

#[derive(Accounts)]
pub struct SnapshotStart<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    pub price_update_a: Box<Account<'info, PriceUpdateV2>>,
    pub price_update_b: Box<Account<'info, PriceUpdateV2>>,
    #[account(address = arena.assets[0].mint @ TribeError::MintMismatch)]
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = arena.assets[1].mint @ TribeError::MintMismatch)]
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,
}

pub fn snapshot_start(ctx: Context<SnapshotStart>) -> Result<()> {
    let t = now()?;
    let inputs = [
        price_input(
            &ctx.accounts.price_update_a,
            &ctx.accounts.mint_a.to_account_info(),
            t,
        )?,
        price_input(
            &ctx.accounts.price_update_b,
            &ctx.accounts.mint_b.to_account_info(),
            t,
        )?,
    ];
    let arena = &mut ctx.accounts.arena;
    eng::snapshot_start(arena, t, &inputs)?;
    emit!(ArenaStarted {
        arena: arena.key(),
        price_a_q10: arena.start_prices[0].price_q10,
        price_b_q10: arena.start_prices[1].price_q10,
    });
    Ok(())
}

// ───────────────────────────────────────── settle

#[derive(Accounts)]
pub struct Settle<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    pub price_update_a: Box<Account<'info, PriceUpdateV2>>,
    pub price_update_b: Box<Account<'info, PriceUpdateV2>>,
    #[account(address = arena.assets[0].mint @ TribeError::MintMismatch)]
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = arena.assets[1].mint @ TribeError::MintMismatch)]
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = config.upset_reserve)]
    pub upset_reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn settle(ctx: Context<Settle>) -> Result<()> {
    let t = now()?;
    let inputs = [
        price_input(
            &ctx.accounts.price_update_a,
            &ctx.accounts.mint_a.to_account_info(),
            t,
        )?,
        price_input(
            &ctx.accounts.price_update_b,
            &ctx.accounts.mint_b.to_account_info(),
            t,
        )?,
    ];
    let reserve_balance = ctx.accounts.upset_reserve.amount;
    let arena = &mut ctx.accounts.arena;
    let out = eng::settle(
        arena,
        t,
        &inputs,
        reserve_balance,
        &ctx.accounts.config.limits,
    )?;
    if out.upset_bonus > 0 {
        let bump = [ctx.accounts.config.bump];
        let seeds: [&[u8]; 2] = [CONFIG_SEED, &bump];
        transfer_from_pda(
            &ctx.accounts.usdc_token_program,
            &ctx.accounts.upset_reserve,
            &ctx.accounts.reward_vault,
            &ctx.accounts.usdc_mint,
            ctx.accounts.config.to_account_info(),
            &[&seeds],
            out.upset_bonus,
        )?;
    }
    emit!(ArenaSettled {
        arena: arena.key(),
        winner: out.winner,
        perf_bps_a: arena.settlement.perf_bps_a,
        perf_bps_b: arena.settlement.perf_bps_b,
        pool_at_settlement: arena.settlement.pool_at_settlement,
        upset_bonus: out.upset_bonus,
        m_settle_q4: arena.settlement.m_settle_q4,
    });
    Ok(())
}

// ───────────────────────────────────────── cancel / extend

#[derive(Accounts)]
pub struct CancelArena<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ TribeError::Unauthorized)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
}

pub fn cancel_arena(ctx: Context<CancelArena>, reason_code: u16) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    eng::cancel_by_authority(arena, now()?)?;
    emit!(ArenaCancelled {
        arena: arena.key(),
        expired: false,
        reason_code
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelExpired<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
}

pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    eng::cancel_expired(arena, now()?)?;
    emit!(ArenaCancelled {
        arena: arena.key(),
        expired: true,
        reason_code: 0
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExtendSettlement<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ TribeError::Unauthorized)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
}

pub fn extend_settlement(ctx: Context<ExtendSettlement>, secs: i64) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    eng::extend_settlement(arena, now()?, secs, &ctx.accounts.config.limits)?;
    emit!(SettlementExtended {
        arena: arena.key(),
        secs
    });
    Ok(())
}

// ───────────────────────────────────────── refund_sponsor

#[derive(Accounts)]
pub struct RefundSponsor<'info> {
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    #[account(
        mut,
        seeds = [SPONSOR_SEED, arena.key().as_ref(), sponsor.key().as_ref()],
        bump = sponsor_record.bump,
        has_one = sponsor @ TribeError::Unauthorized,
    )]
    pub sponsor_record: Box<Account<'info, Sponsor>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = sponsor)]
    pub sponsor_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn refund_sponsor(ctx: Context<RefundSponsor>) -> Result<()> {
    let rec = &mut ctx.accounts.sponsor_record;
    require!(!rec.refunded, TribeError::SponsorAlreadyRefunded);
    require!(rec.amount > 0, TribeError::SponsorNotFound);
    let amount = rec.amount;
    let arena = &mut ctx.accounts.arena;
    eng::refund_sponsor(arena, amount)?;
    rec.refunded = true;
    let bump = [arena.bump];
    let seeds = arena_signer_seeds(arena, &bump);
    transfer_from_pda(
        &ctx.accounts.usdc_token_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.sponsor_usdc,
        &ctx.accounts.usdc_mint,
        arena.to_account_info(),
        &[&seeds],
        amount,
    )?;
    emit!(SponsorRefunded {
        arena: arena.key(),
        sponsor: ctx.accounts.sponsor.key(),
        amount
    });
    Ok(())
}

// ───────────────────────────────────────── sweep_unclaimed

#[derive(Accounts)]
pub struct SweepUnclaimed<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_SEED, arena.creator.as_ref(), &arena.nonce_le], bump = arena.bump)]
    pub arena: Box<Account<'info, Arena>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = arena.reward_vault)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Rollover destination: the protocol treasury (per-pair rollover vaults are post-MVP).
    #[account(mut, address = config.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    let amount = eng::sweep_unclaimed(arena, now()?, &ctx.accounts.config.limits)?;
    if amount > 0 {
        let bump = [arena.bump];
        let seeds = arena_signer_seeds(arena, &bump);
        transfer_from_pda(
            &ctx.accounts.usdc_token_program,
            &ctx.accounts.reward_vault,
            &ctx.accounts.treasury,
            &ctx.accounts.usdc_mint,
            arena.to_account_info(),
            &[&seeds],
            amount,
        )?;
    }
    emit!(UnclaimedSwept {
        arena: arena.key(),
        amount
    });
    Ok(())
}

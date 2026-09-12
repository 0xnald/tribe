use crate::errors::TribeError;
use crate::state::*;
use crate::token::inspect_mint;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitConfigArgs {
    pub fee_policy: FeePolicy,
    pub limits: ProtocolLimits,
    pub default_params: ArenaParams,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    /// Protocol treasury USDC account (any owner chosen by the authority).
    #[account(token::mint = usdc_mint, token::token_program = usdc_token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    /// Upset Reserve: ATA of the config PDA.
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = config,
        associated_token::token_program = usdc_token_program,
    )]
    pub upset_reserve: InterfaceAccount<'info, TokenAccount>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
    let f = &args.fee_policy;
    require!(
        f.fee_bps <= 10_000
            && f.reward_pool_bps as u32 + f.protocol_bps as u32 + f.creator_bps as u32 == 10_000
            && f.first_party_creator_target <= creator_target::REWARD_POOL,
        TribeError::InvalidParams
    );
    let l = &args.limits;
    require!(
        l.min_duration_secs > 0
            && l.min_duration_secs < l.max_duration_secs
            && l.reserve_draw_bps <= 10_000,
        TribeError::InvalidParams
    );
    let p = &args.default_params;
    require!(
        p.tie_bps <= 10_000
            && p.min_hold_bps < 10_000
            && p.underdog.cap_q4 >= 10_000
            && p.underdog.warmup_bps <= 10_000,
        TribeError::InvalidParams
    );
    let c = &mut ctx.accounts.config;
    c.authority = ctx.accounts.authority.key();
    c.usdc_mint = ctx.accounts.usdc_mint.key();
    c.treasury = ctx.accounts.treasury.key();
    c.upset_reserve = ctx.accounts.upset_reserve.key();
    c.fee_policy = args.fee_policy;
    c.limits = args.limits;
    c.default_params = args.default_params;
    c.paused = false;
    c.bump = ctx.bumps.config;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SetAssetArgs {
    pub asset_class: u8,
    pub feed_id: [u8; 32],
    pub tolerance_secs: i64,
    pub max_closed_staleness_secs: i64,
    pub max_conf_bps: u16,
    pub status: u8,
}

#[derive(Accounts)]
pub struct SetAsset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ TribeError::Unauthorized)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AssetEntry::INIT_SPACE,
        seeds = [ASSET_SEED, mint.key().as_ref()],
        bump,
    )]
    pub asset: Account<'info, AssetEntry>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn set_asset(ctx: Context<SetAsset>, args: SetAssetArgs) -> Result<()> {
    require!(
        args.asset_class <= asset_class::COMMODITY
            && args.status <= asset_status::RETIRED
            && args.tolerance_secs >= 0
            && args.max_closed_staleness_secs >= 0,
        TribeError::InvalidParams
    );
    let facts = inspect_mint(&ctx.accounts.mint, &ctx.accounts.token_program.key())?;
    let a = &mut ctx.accounts.asset;
    a.mint = ctx.accounts.mint.key();
    a.token_program = ctx.accounts.token_program.key();
    a.decimals = ctx.accounts.mint.decimals;
    a.asset_class = args.asset_class;
    a.feed_id = args.feed_id;
    a.scaled_ui = facts.scaled_ui;
    a.tolerance_secs = args.tolerance_secs;
    a.max_closed_staleness_secs = args.max_closed_staleness_secs;
    a.max_conf_bps = args.max_conf_bps;
    a.status = args.status;
    a.bump = ctx.bumps.asset;
    Ok(())
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ TribeError::Unauthorized)]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

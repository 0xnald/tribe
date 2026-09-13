//! Tribe Arena — the on-chain subset of Tribe (docs/ARCHITECTURE.md §8).
//!
//! Users own real spot assets; Arenas decide additional rewards only.
//! Principal never moves between users: the only instruction that moves
//! position assets is `exit`, signed by the owner, to the owner.

#![allow(clippy::result_large_err)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod engine;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod token;

use instructions::*;

declare_id!("shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4");

#[program]
pub mod tribe_arena {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
        instructions::init_config(ctx, args)
    }

    pub fn set_asset(ctx: Context<SetAsset>, args: SetAssetArgs) -> Result<()> {
        instructions::set_asset(ctx, args)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }

    pub fn create_arena(ctx: Context<CreateArena>, args: CreateArenaArgs) -> Result<()> {
        instructions::create_arena(ctx, args)
    }

    pub fn fund_reward_pool(ctx: Context<FundRewardPool>, amount: u64) -> Result<()> {
        instructions::fund_reward_pool(ctx, amount)
    }

    pub fn snapshot_start(ctx: Context<SnapshotStart>) -> Result<()> {
        instructions::snapshot_start(ctx)
    }

    pub fn open_position(ctx: Context<OpenPosition>, side: u8) -> Result<()> {
        instructions::open_position(ctx, side)
    }

    pub fn back(ctx: Context<Back>, side: u8, units: u64, fee_paid: u64) -> Result<()> {
        instructions::back(ctx, side, units, fee_paid)
    }

    pub fn exit(ctx: Context<Exit>, units: u64) -> Result<()> {
        instructions::exit(ctx, units)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim(ctx)
    }

    pub fn cancel_arena(ctx: Context<CancelArena>, reason_code: u16) -> Result<()> {
        instructions::cancel_arena(ctx, reason_code)
    }

    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        instructions::cancel_expired(ctx)
    }

    pub fn extend_settlement(ctx: Context<ExtendSettlement>, secs: i64) -> Result<()> {
        instructions::extend_settlement(ctx, secs)
    }

    pub fn refund_sponsor(ctx: Context<RefundSponsor>) -> Result<()> {
        instructions::refund_sponsor(ctx)
    }

    pub fn sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
        instructions::sweep_unclaimed(ctx)
    }
}

//! Fee engine — transcription of `packages/core/src/engine/fees.ts` (ECONOMICS §3).

use crate::engine::math::to_u64;
use crate::state::{creator_target, FeePolicy};
use anchor_lang::prelude::*;

/// `fee_required = notional × fee_bps / 10_000` (floor).
pub fn fee_required(notional_usdc: u64, fee_bps: u16) -> Result<u64> {
    to_u64((notional_usdc as u128) * (fee_bps as u128) / 10_000)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeSplit {
    pub to_pool: u64,
    pub to_protocol: u64,
    pub to_creator: u64,
}

/// Split a paid fee; the protocol share absorbs rounding so the three parts
/// sum to `fee_paid` exactly. `target` routes the creator share.
pub fn split_fee(fee_paid: u64, policy: &FeePolicy, target: u8) -> Result<FeeSplit> {
    let f = fee_paid as u128;
    let pool = to_u64(f * policy.reward_pool_bps as u128 / 10_000)?;
    let creator = to_u64(f * policy.creator_bps as u128 / 10_000)?;
    let protocol = fee_paid - pool - creator;
    Ok(match target {
        creator_target::PROTOCOL => FeeSplit {
            to_pool: pool,
            to_protocol: protocol + creator,
            to_creator: 0,
        },
        creator_target::REWARD_POOL => FeeSplit {
            to_pool: pool + creator,
            to_protocol: protocol,
            to_creator: 0,
        },
        _ => FeeSplit {
            to_pool: pool,
            to_protocol: protocol,
            to_creator: creator,
        },
    })
}

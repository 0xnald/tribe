//! Upset Bonus — transcription of `packages/core/src/engine/upset.ts` (ECONOMICS §7.3).

use crate::engine::math::{to_u64, ONE_Q4};
use crate::engine::underdog::raw_multiplier_q4;
use crate::errors::TribeError;
use crate::state::UnderdogPolicy;
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Limiter {
    None,
    Formula,
    ReserveDraw,
    ReserveBalance,
    Cap,
}

pub struct UpsetResult {
    pub m_upset_q4: u128,
    pub requested: u64,
    pub bonus: u64,
    pub limited_by: Limiter,
}

pub fn compute_upset_bonus(
    winner_twab_share_bps: u128,
    base_pool: u64,
    reserve_balance: u64,
    underdog: &UnderdogPolicy,
    reserve_draw_bps: u16,
    upset_bonus_cap_usdc: u64,
) -> Result<UpsetResult> {
    require!(winner_twab_share_bps <= 10_000, TribeError::InvalidParams);
    let m = raw_multiplier_q4(winner_twab_share_bps, underdog);
    let requested = to_u64((base_pool as u128) * (m - ONE_Q4) / ONE_Q4)?;
    if requested == 0 {
        return Ok(UpsetResult {
            m_upset_q4: m,
            requested,
            bonus: 0,
            limited_by: Limiter::Formula,
        });
    }
    let draw_limit = to_u64((reserve_balance as u128) * (reserve_draw_bps as u128) / 10_000)?;
    // precedence: reserve balance, reserve draw, absolute cap
    let mut bonus = requested;
    let mut limited_by = Limiter::None;
    for (v, why) in [
        (reserve_balance, Limiter::ReserveBalance),
        (draw_limit, Limiter::ReserveDraw),
        (upset_bonus_cap_usdc, Limiter::Cap),
    ] {
        if v < bonus {
            bonus = v;
            limited_by = why;
        }
    }
    Ok(UpsetResult {
        m_upset_q4: m,
        requested,
        bonus: bonus.min(reserve_balance),
        limited_by,
    })
}

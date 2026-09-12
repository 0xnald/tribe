//! Underdog multiplier — transcription of `packages/core/src/engine/underdog.ts`
//! (ECONOMICS §7.1–7.2), Q4 fixed point.

use crate::engine::math::{mul_u128, ONE_Q4};
use crate::engine::shares::{instant_share_after_deposit_bps, twab_share_bps, Valuation};
use crate::errors::TribeError;
use crate::state::{SideState, UnderdogPolicy};
use anchor_lang::prelude::*;

/// `raw_m = clamp(1 + slope × (0.5 − share), 1, cap)` in Q4.
pub fn raw_multiplier_q4(share_eff_bps: u128, policy: &UnderdogPolicy) -> u128 {
    let slope = policy.slope as i128;
    let cap = policy.cap_q4 as i128;
    let raw = ONE_Q4 as i128 + slope * (5000 - share_eff_bps as i128);
    raw.clamp(ONE_Q4 as i128, cap) as u128
}

/// `warmup = max(duration × warmup_bps / 10_000, warmup_floor_secs)`.
pub fn warmup_secs(duration_secs: i64, policy: &UnderdogPolicy) -> u128 {
    let d = duration_secs.max(0) as u128;
    let pct = d * policy.warmup_bps as u128 / 10_000;
    pct.max(policy.warmup_floor_secs.max(0) as u128)
}

/// Linear ramp of the boost over the warm-up window.
pub fn ramp_multiplier_q4(raw_q4: u128, elapsed_secs: i64, warmup: u128) -> Result<u128> {
    require!(elapsed_secs >= 0, TribeError::TooEarly);
    if warmup == 0 {
        return Ok(raw_q4);
    }
    let boost = raw_q4 - ONE_Q4;
    let e = (elapsed_secs as u128).min(warmup);
    Ok(ONE_Q4 + mul_u128(boost, e)? / warmup)
}

pub struct MultiplierResult {
    pub m_q4: u128,
    pub raw_q4: u128,
    pub share_inst_bps: u128,
    pub share_twab_bps: Option<u128>,
    pub share_eff_bps: u128,
    pub warmup: u128,
    pub elapsed: i64,
}

/// Multiplier for a tranche deposited now (sides already accrued to `now`).
#[allow(clippy::too_many_arguments)]
pub fn underdog_multiplier(
    sides: &[SideState; 2],
    vals: &[Valuation; 2],
    side: usize,
    deposit_units: u64,
    now: i64,
    start_ts: i64,
    end_ts: i64,
    policy: &UnderdogPolicy,
) -> Result<MultiplierResult> {
    let share_inst_bps = instant_share_after_deposit_bps(sides, vals, side, deposit_units)?;
    let share_twab = twab_share_bps(sides, vals, side)?;
    let share_eff_bps = match share_twab {
        None => share_inst_bps,
        Some(t) => share_inst_bps.max(t),
    };
    let raw_q4 = raw_multiplier_q4(share_eff_bps, policy);
    let warmup = warmup_secs(end_ts - start_ts, policy);
    let elapsed = now - start_ts;
    let m_q4 = ramp_multiplier_q4(raw_q4, elapsed, warmup)?;
    Ok(MultiplierResult {
        m_q4,
        raw_q4,
        share_inst_bps,
        share_twab_bps: share_twab,
        share_eff_bps,
        warmup,
        elapsed,
    })
}

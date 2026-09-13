//! Time-weighted conviction accumulators — transcription of
//! `packages/core/src/engine/accrual.ts` (ECONOMICS §5).

use crate::engine::math::{add_u128, mul_u128, sub_u128};
use crate::errors::TribeError;
use crate::state::{Position, SideState};
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub start_ts: i64,
    pub end_ts: i64,
}

pub fn clamp_ts(ts: i64, w: &Window) -> i64 {
    ts.clamp(w.start_ts, w.end_ts)
}

/// Seconds of accrual between two raw timestamps, inside the window only.
pub fn accrual_delta(last_ts: i64, now: i64, w: &Window) -> Result<u128> {
    require!(now >= last_ts, TribeError::NonMonotonicClock);
    let dt = clamp_ts(now, w) - clamp_ts(last_ts, w);
    Ok(if dt < 0 { 0 } else { dt as u128 })
}

pub fn accrue_side(side: &mut SideState, dt: u128) -> Result<()> {
    if dt == 0 {
        return Ok(());
    }
    side.unit_seconds = add_u128(side.unit_seconds, mul_u128(side.units as u128, dt)?)?;
    side.reward_unit_seconds =
        add_u128(side.reward_unit_seconds, mul_u128(side.units as u128, dt)?)?;
    side.eff_unit_seconds = add_u128(side.eff_unit_seconds, mul_u128(side.eff_units, dt)?)?;
    Ok(())
}

/// Accrue a position up to `now`, updating its touch timestamp.
pub fn accrue_position(p: &mut Position, now: i64, w: &Window) -> Result<()> {
    let dt = accrual_delta(p.last_touch_ts, now, w)?;
    p.unit_seconds = add_u128(p.unit_seconds, mul_u128(p.units as u128, dt)?)?;
    p.eff_unit_seconds = add_u128(p.eff_unit_seconds, mul_u128(p.eff_units, dt)?)?;
    p.last_touch_ts = p.last_touch_ts.max(now);
    Ok(())
}

/// Apply a deposit tranche of `units` at multiplier `m_q4` (ECONOMICS §5.4).
pub fn apply_deposit(
    p: &mut Position,
    side: &mut SideState,
    units: u64,
    m_q4: u32,
    fee_paid: u64,
) -> Result<()> {
    require!(units > 0, TribeError::ZeroAmount);
    let eff = mul_u128(units as u128, m_q4 as u128)?;
    let is_new = p.units == 0 && p.deposits == 0;
    p.units = p
        .units
        .checked_add(units)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    p.eff_units = add_u128(p.eff_units, eff)?;
    p.deposits = p
        .deposits
        .checked_add(1)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    p.fee_paid = p
        .fee_paid
        .checked_add(fee_paid)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    side.units = side
        .units
        .checked_add(units)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    side.eff_units = add_u128(side.eff_units, eff)?;
    if is_new {
        side.participants = side
            .participants
            .checked_add(1)
            .ok_or_else(|| error!(TribeError::MathOverflow))?;
    }
    Ok(())
}

pub struct ExitResult {
    pub removed_eff: u128,
    pub removed_eff_seconds: u128,
    pub removed_unit_seconds: u128,
}

/// Exit `x` units (ECONOMICS §5.5). With `forfeit` both live and accrued
/// weight are reduced proportionally (floor on the kept part); without it
/// only units move.
pub fn apply_exit(
    p: &mut Position,
    side: &mut SideState,
    x: u64,
    forfeit: bool,
) -> Result<ExitResult> {
    require!(x > 0, TribeError::ZeroAmount);
    require!(x <= p.units, TribeError::InsufficientUnits);
    let u = p.units as u128;
    let keep = u - x as u128;
    let mut r = ExitResult {
        removed_eff: 0,
        removed_eff_seconds: 0,
        removed_unit_seconds: 0,
    };
    if forfeit {
        r.removed_eff = sub_u128(p.eff_units, mul_u128(p.eff_units, keep)? / u)?;
        r.removed_eff_seconds =
            sub_u128(p.eff_unit_seconds, mul_u128(p.eff_unit_seconds, keep)? / u)?;
        r.removed_unit_seconds = sub_u128(p.unit_seconds, mul_u128(p.unit_seconds, keep)? / u)?;
    }
    p.units -= x;
    p.unit_seconds = sub_u128(p.unit_seconds, r.removed_unit_seconds)?;
    p.eff_units = sub_u128(p.eff_units, r.removed_eff)?;
    p.eff_unit_seconds = sub_u128(p.eff_unit_seconds, r.removed_eff_seconds)?;
    p.forfeited = p.forfeited || (forfeit && p.units == 0);
    side.units = side
        .units
        .checked_sub(x)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    side.reward_unit_seconds = sub_u128(side.reward_unit_seconds, r.removed_unit_seconds)?;
    side.eff_units = sub_u128(side.eff_units, r.removed_eff)?;
    side.eff_unit_seconds = sub_u128(side.eff_unit_seconds, r.removed_eff_seconds)?;
    Ok(r)
}

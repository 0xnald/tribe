//! Backing shares — transcription of `packages/core/src/engine/twab.ts`.

use crate::engine::math::{add_u128, mul_div, mul_u128, pow10, BPS};
use crate::state::SideState;
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug)]
pub struct Valuation {
    /// Arena start reference price, Q10.
    pub price_q10: u64,
    pub decimals: u8,
}

/// USD × 1e10 scale value of `units` (only ratios are ever taken).
pub fn usd_of(units: u128, v: &Valuation) -> Result<u128> {
    mul_div(units, v.price_q10 as u128, pow10(v.decimals as u32)?)
}

pub fn side_usd(side: &SideState, v: &Valuation) -> Result<u128> {
    usd_of(side.units as u128, v)
}

pub fn side_usd_seconds(side: &SideState, v: &Valuation) -> Result<u128> {
    usd_of(side.unit_seconds, v)
}

/// Instantaneous share of `side` (0 = A, 1 = B) in bps AFTER adding `deposit_units`.
pub fn instant_share_after_deposit_bps(
    sides: &[SideState; 2],
    vals: &[Valuation; 2],
    side: usize,
    deposit_units: u64,
) -> Result<u128> {
    let dep = usd_of(deposit_units as u128, &vals[side])?;
    let a = side_usd(&sides[0], &vals[0])?;
    let b = side_usd(&sides[1], &vals[1])?;
    let mine = add_u128(if side == 0 { a } else { b }, dep)?;
    let total = add_u128(add_u128(a, b)?, dep)?;
    if total == 0 {
        return Ok(5000);
    }
    Ok(mul_u128(mine, BPS)? / total)
}

/// Time-weighted share BEFORE the deposit, or `None` when nothing accrued yet.
pub fn twab_share_bps(
    sides: &[SideState; 2],
    vals: &[Valuation; 2],
    side: usize,
) -> Result<Option<u128>> {
    let a = side_usd_seconds(&sides[0], &vals[0])?;
    let b = side_usd_seconds(&sides[1], &vals[1])?;
    let total = add_u128(a, b)?;
    if total == 0 {
        return Ok(None);
    }
    Ok(Some(mul_u128(if side == 0 { a } else { b }, BPS)? / total))
}

/// Whole-Arena TWAB share used at settlement; 5000 if nothing accrued.
pub fn settlement_twab_share_bps(
    sides: &[SideState; 2],
    vals: &[Valuation; 2],
    side: usize,
) -> Result<u128> {
    Ok(twab_share_bps(sides, vals, side)?.unwrap_or(5000))
}

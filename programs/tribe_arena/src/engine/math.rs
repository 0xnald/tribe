//! Fixed-point primitives — transcription of `packages/core/src/math/fixed.ts`.
//! All money paths are integer; every operation is checked.

use crate::engine::u256::U256;
use crate::errors::TribeError;
use anchor_lang::prelude::*;

/// Exact `floor(a × b / d)` with a 256-bit intermediate; errors only if the
/// quotient itself does not fit u128 (or d == 0). Mirrors bigint semantics.
pub fn mul_div(a: u128, b: u128, d: u128) -> Result<u128> {
    require!(d != 0, TribeError::MathOverflow);
    let q = U256::from(a) * U256::from(b) / U256::from(d);
    if q > U256::from(u128::MAX) {
        return err!(TribeError::MathOverflow);
    }
    Ok(q.as_u128())
}

pub const BPS: u128 = 10_000;
/// Q4 multiplier scale: 10_000 = 1.0×.
pub const ONE_Q4: u128 = 10_000;
/// xStocks scaled-UI multiplier scale: 1_000_000 = 1.0.
pub const MULT_Q6: u128 = 1_000_000;

pub fn pow10(n: u32) -> Result<u128> {
    require!(n <= 38, TribeError::InvalidParams);
    10u128
        .checked_pow(n)
        .ok_or_else(|| error!(TribeError::MathOverflow))
}

pub fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(TribeError::MathOverflow))
}

/// Normalise a Pyth (price, expo) pair to Q8 (USD × 1e8). Rejects non-positive
/// prices and exponents outside [-18, 8]; the result must fit u64.
pub fn to_q8(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, TribeError::OracleNonPositivePrice);
    require!(
        (-18..=8).contains(&expo),
        TribeError::OracleUnsupportedExponent
    );
    let p = price as u128;
    let shift = 8 + expo; // expo −8 → no shift
    let q8 = if shift >= 0 {
        p.checked_mul(pow10(shift as u32)?)
            .ok_or_else(|| error!(TribeError::MathOverflow))?
    } else {
        p / pow10((-shift) as u32)?
    };
    require!(q8 > 0, TribeError::OracleNonPositivePrice);
    to_u64(q8)
}

/// Reference price of one raw unit: `underlying × mult_q6 / 1e6`.
pub fn ref_price_q8(underlying_q8: u64, mult_q6: u64) -> Result<u64> {
    require!(mult_q6 > 0, TribeError::InvalidParams);
    let v = (underlying_q8 as u128)
        .checked_mul(mult_q6 as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?
        / MULT_Q6;
    to_u64(v)
}

/// `notional_usdc(units, P_ref, d) = units × P_ref / 10^(d + 2)` → micro-USDC.
pub fn notional_usdc(units: u64, price_q8: u64, decimals: u8) -> Result<u64> {
    require!(decimals <= 18, TribeError::InvalidParams);
    let v = (units as u128)
        .checked_mul(price_q8 as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?
        / pow10(decimals as u32 + 2)?;
    to_u64(v)
}

/// `perf_bps = (P_end − P_start) × 10_000 / P_start`, floored toward −∞.
pub fn perf_bps(start_q8: u64, end_q8: u64) -> Result<i64> {
    require!(start_q8 > 0, TribeError::InvalidParams);
    let num = (end_q8 as i128 - start_q8 as i128)
        .checked_mul(10_000)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    let q = num.div_euclid(start_q8 as i128);
    i64::try_from(q).map_err(|_| error!(TribeError::MathOverflow))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WinnerSide {
    A,
    B,
    Tie,
}

/// Division-free winner rule with a tie band (ECONOMICS §2).
pub fn decide_winner(
    start_a: u64,
    end_a: u64,
    start_b: u64,
    end_b: u64,
    tie_bps: u16,
) -> Result<WinnerSide> {
    for p in [start_a, end_a, start_b, end_b] {
        require!(p > 0, TribeError::InvalidParams);
    }
    let lhs = (end_a as u128)
        .checked_mul(start_b as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    let rhs = (end_b as u128)
        .checked_mul(start_a as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    let band = (tie_bps as u128)
        .checked_mul(start_a as u128)
        .and_then(|v| v.checked_mul(start_b as u128))
        .ok_or_else(|| error!(TribeError::MathOverflow))?
        / BPS;
    let diff = lhs.abs_diff(rhs);
    if diff <= band {
        Ok(WinnerSide::Tie)
    } else if lhs > rhs {
        Ok(WinnerSide::A)
    } else {
        Ok(WinnerSide::B)
    }
}

pub fn mul_u128(a: u128, b: u128) -> Result<u128> {
    a.checked_mul(b)
        .ok_or_else(|| error!(TribeError::MathOverflow))
}

pub fn add_u128(a: u128, b: u128) -> Result<u128> {
    a.checked_add(b)
        .ok_or_else(|| error!(TribeError::MathOverflow))
}

pub fn sub_u128(a: u128, b: u128) -> Result<u128> {
    a.checked_sub(b)
        .ok_or_else(|| error!(TribeError::MathOverflow))
}

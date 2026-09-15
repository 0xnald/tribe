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
/// Reference-price scale: Q10 = USD × 1e10 (sub-cent assets keep bps resolution).
pub const PRICE_DECIMALS: u32 = 10;
pub const Q10: u128 = 10_000_000_000;

pub fn pow10(n: u32) -> Result<u128> {
    require!(n <= 38, TribeError::InvalidParams);
    10u128
        .checked_pow(n)
        .ok_or_else(|| error!(TribeError::MathOverflow))
}

pub fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(TribeError::MathOverflow))
}

/// Normalise a Pyth (price, expo) pair to Q10 (USD × 1e10). Rejects
/// non-positive prices and exponents outside [-18, 8]; the result must fit
/// u64, which bounds the reference price at ≈ $1.84e9 per unit.
pub fn to_q10(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, TribeError::OracleNonPositivePrice);
    require!(
        (-18..=8).contains(&expo),
        TribeError::OracleUnsupportedExponent
    );
    let p = price as u128;
    let shift = PRICE_DECIMALS as i32 + expo; // expo −10 → no shift
    let q10 = if shift >= 0 {
        p.checked_mul(pow10(shift as u32)?)
            .ok_or_else(|| error!(TribeError::MathOverflow))?
    } else {
        p / pow10((-shift) as u32)?
    };
    require!(q10 > 0, TribeError::OracleNonPositivePrice);
    to_u64(q10)
}

/// Reference price of one raw unit: `underlying × mult_q6 / 1e6`.
pub fn ref_price_q10(underlying_q10: u64, mult_q6: u64) -> Result<u64> {
    require!(mult_q6 > 0, TribeError::InvalidParams);
    let v = (underlying_q10 as u128)
        .checked_mul(mult_q6 as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?
        / MULT_Q6;
    to_u64(v)
}

/// `notional_usdc(units, P_ref, d) = units × P_ref / 10^(d + 4)` → micro-USDC
/// (Q10 → 6-decimal USDC). u64 × u64 always fits u128.
pub fn notional_usdc(units: u64, price_q10: u64, decimals: u8) -> Result<u64> {
    require!(decimals <= 18, TribeError::InvalidParams);
    let v = (units as u128)
        .checked_mul(price_q10 as u128)
        .ok_or_else(|| error!(TribeError::MathOverflow))?
        / pow10(decimals as u32 + PRICE_DECIMALS - 6)?;
    to_u64(v)
}

/// `perf_bps = (P_end − P_start) × 10_000 / P_start`, floored toward −∞. Scale-free.
pub fn perf_bps(start_q10: u64, end_q10: u64) -> Result<i64> {
    require!(start_q10 > 0, TribeError::InvalidParams);
    let num = (end_q10 as i128 - start_q10 as i128)
        .checked_mul(10_000)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    let q = num.div_euclid(start_q10 as i128);
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
    // 256-bit intermediates: u64 × u64 < 2^128 and tie_bps × 2^128 < 2^256, so any
    // u64 prices are safe (mirrors packages/core assertU256).
    let lhs = U256::from(end_a) * U256::from(start_b);
    let rhs = U256::from(end_b) * U256::from(start_a);
    let band = U256::from(tie_bps) * U256::from(start_a) * U256::from(start_b) / U256::from(BPS);
    let diff = if lhs > rhs { lhs - rhs } else { rhs - lhs };
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

#[cfg(test)]
mod tests {
    //! Executable headroom and precision checks for the Q10 reference-price
    //! scale (twins of packages/core/src/math/fixed.test.ts).
    use super::*;

    const S: u64 = 1_000_000_000_000; // $100 in Q10
    const BONK_271: u64 = 27_100; // $0.00000271
    const U64_MAX: u64 = u64::MAX;

    #[test]
    fn to_q10_scales_pyth_exponents() {
        assert_eq!(to_q10(36_525_000_000, -8).unwrap(), 3_652_500_000_000);
        assert_eq!(to_q10(271, -8).unwrap(), BONK_271);
        assert_eq!(to_q10(2_710, -9).unwrap(), BONK_271);
        assert_eq!(to_q10(2_816_164_455, -15).unwrap(), 28_161);
        assert!(to_q10(1 << 62, 8).is_err()); // exceeds u64
        assert!(to_q10(1, -18).is_err()); // underflows to 0
        assert_eq!(
            to_q10(1_000_000_000, 0).unwrap(),
            1_000_000_000 * Q10 as u64
        );
        assert!(to_q10(2_000_000_000, 0).is_err()); // $2e9 exceeds u64
    }

    #[test]
    fn bonk_precision_below_the_old_q8_step() {
        // one tick is 0.37 bps at $0.00000271; +0.05 % is 13 ticks and decides against a flat side
        let up5bps = BONK_271 * 10_005 / 10_000;
        assert_eq!(up5bps, 27_113);
        assert_eq!(perf_bps(BONK_271, up5bps).unwrap(), 4);
        assert_eq!(perf_bps(BONK_271, BONK_271 + 1).unwrap(), 0);
        assert_eq!(perf_bps(BONK_271, BONK_271 + 3).unwrap(), 1);
        assert_eq!(
            decide_winner(BONK_271, up5bps, S, S, 1).unwrap(),
            WinnerSide::A
        );
        assert_eq!(
            decide_winner(BONK_271, BONK_271 + 1, S, S, 1).unwrap(),
            WinnerSide::Tie
        );
        assert_eq!(
            decide_winner(BONK_271, BONK_271 + 3, S, S, 1).unwrap(),
            WinnerSide::A
        );
        // 2.50 → 2.71 (+8.4 %) vs 2.71 → 3.00 (+10.7 %)
        assert_eq!(
            decide_winner(25_000, BONK_271, BONK_271, 30_000, 1).unwrap(),
            WinnerSide::B
        );
        assert_eq!(
            notional_usdc(1_000_000_000_000, BONK_271, 5).unwrap(),
            27_100_000
        );
        assert_eq!(notional_usdc(1, BONK_271, 5).unwrap(), 0);
    }

    #[test]
    fn notional_matches_q8_rational_exactly() {
        let units = 62_277_580_071_173u64;
        assert_eq!(
            notional_usdc(units, 28_100, 5).unwrap() as u128,
            units as u128 * 281 / 10_000_000
        );
    }

    #[test]
    fn headroom_up_to_u64_prices() {
        for p in [
            1_200_000_000_000_000u64,
            10u64.pow(16),
            10u64.pow(18),
            U64_MAX,
        ] {
            assert_eq!(decide_winner(p, p, p, p, 10_000).unwrap(), WinnerSide::Tie);
            assert_eq!(decide_winner(p, p, p - 1, p, 0).unwrap(), WinnerSide::B);
            assert_eq!(decide_winner(p - 1, p, p, p, 0).unwrap(), WinnerSide::A);
            assert_eq!(perf_bps(p, p).unwrap(), 0);
            // max units at max price: u64 × u64 fits u128; result must fit u64 or fail cleanly
            let n = (U64_MAX as u128) * (p as u128) / pow10(4).unwrap();
            match notional_usdc(U64_MAX, p, 0) {
                Ok(v) => assert_eq!(v as u128, n),
                Err(_) => assert!(n > u64::MAX as u128),
            }
        }
        // ScaledUi multiplier up to 100× keeps $18.4M in u64, $36.8M does not
        assert_eq!(
            ref_price_q10(184_467_440_000_000_000, 100_000_000).unwrap(),
            18_446_744_000_000_000_000
        );
        assert!(ref_price_q10(184_467_440_000_000_000 * 2, 100_000_000).is_err());
    }
}

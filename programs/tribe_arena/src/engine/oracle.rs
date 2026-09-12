//! Oracle input validation — transcription of `packages/core/src/engine/oracle.ts`.
//! Works on already-parsed fields so it is testable without a live Pyth
//! account; the instruction layer extracts them from `PriceUpdateV2`.

use crate::engine::math::{ref_price_q8, to_q8, MULT_Q6};
use crate::errors::TribeError;
use crate::state::{asset_class, price_mode, ArenaAsset, PriceSnapshot};
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug)]
pub struct PriceInput {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub fully_verified: bool,
    /// Scaled-UI multiplier read from the mint (Q6); ignored for non-scaled assets.
    pub mult_q6: Option<u64>,
}

/// Exact mode: |publish − target| ≤ tolerance.
/// LastKnown mode (non-crypto, allowed): target − max_closed ≤ publish ≤ target.
pub fn validate_price_update(
    input: &PriceInput,
    asset: &ArenaAsset,
    target_ts: i64,
    allow_closed: bool,
) -> Result<PriceSnapshot> {
    require!(input.feed_id == asset.feed_id, TribeError::OracleFeedMismatch);
    require!(input.fully_verified, TribeError::OracleNotFullyVerified);
    require!(input.price > 0, TribeError::OracleNonPositivePrice);
    // conf × 10_000 / price ≤ max_conf_bps (same exponent)
    let conf_bps = (input.conf as u128) * 10_000 / (input.price as u128);
    require!(
        conf_bps <= asset.max_conf_bps as u128,
        TribeError::OracleConfidenceTooWide
    );

    let diff = input.publish_time - target_ts;
    let abs_diff = diff.abs();
    let mode = if abs_diff <= asset.tolerance_secs {
        price_mode::EXACT
    } else if diff > 0 {
        return err!(TribeError::OracleTooEarly);
    } else {
        let last_known_allowed = allow_closed
            && asset.asset_class != asset_class::CRYPTO
            && asset.max_closed_staleness_secs > 0;
        require!(
            last_known_allowed && abs_diff <= asset.max_closed_staleness_secs,
            TribeError::OracleStale
        );
        price_mode::LAST_KNOWN
    };

    let oracle_price_q8 = to_q8(input.price, input.expo)?;
    let mult_q6 = if asset.scaled_ui {
        input.mult_q6.unwrap_or(MULT_Q6 as u64)
    } else {
        MULT_Q6 as u64
    };
    require!(mult_q6 > 0, TribeError::InvalidParams);
    let price_q8 = ref_price_q8(oracle_price_q8, mult_q6)?;
    Ok(PriceSnapshot {
        price_q8,
        oracle_price_q8,
        publish_time: input.publish_time,
        mode,
        mult_q6,
    })
}

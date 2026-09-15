//! Arena transitions — transcription of `packages/core/src/engine/arena.ts`.
//! These functions mutate the account structs and perform every check the
//! reducer performs; instruction handlers wrap them with account validation
//! and token transfers. The vector replay test drives them directly.

use crate::engine::accrual::{
    accrual_delta, accrue_position, accrue_side, apply_deposit, apply_exit, ExitResult,
};
use crate::engine::fees::{fee_required, split_fee, FeeSplit};
use crate::engine::math::{add_u128, decide_winner, mul_u128, notional_usdc, perf_bps, WinnerSide};
use crate::engine::oracle::{validate_price_update, PriceInput};
use crate::engine::shares::{settlement_twab_share_bps, Valuation};
use crate::engine::underdog::underdog_multiplier;
use crate::engine::upset::compute_upset_bonus;
use crate::errors::TribeError;
use crate::state::{
    arena_status, cancel_reason, winner, Arena, ArenaParams, Position, ProtocolLimits,
};
use anchor_lang::prelude::*;

pub fn min_hold_secs(params: &ArenaParams, duration: i64) -> i64 {
    let pct = (duration.max(0) as i128 * params.min_hold_bps as i128 / 10_000) as i64;
    pct.max(params.min_hold_floor_secs)
}

pub fn valuations(arena: &Arena) -> Result<[Valuation; 2]> {
    require!(
        arena.start_prices[0].price_q10 > 0 && arena.start_prices[1].price_q10 > 0,
        TribeError::InvalidStatus
    );
    Ok([
        Valuation {
            price_q10: arena.start_prices[0].price_q10,
            decimals: arena.assets[0].decimals,
        },
        Valuation {
            price_q10: arena.start_prices[1].price_q10,
            decimals: arena.assets[1].decimals,
        },
    ])
}

/// Accrue both sides to `now` (Arena-level clock).
pub fn accrue_arena(arena: &mut Arena, now: i64) -> Result<()> {
    let w = arena.window();
    let dt = accrual_delta(arena.last_accrual_ts, now, &w)?;
    accrue_side(&mut arena.sides[0], dt)?;
    accrue_side(&mut arena.sides[1], dt)?;
    arena.last_accrual_ts = arena.last_accrual_ts.max(now);
    Ok(())
}

pub fn require_status(arena: &Arena, allowed: &[u8]) -> Result<()> {
    require!(allowed.contains(&arena.status), TribeError::InvalidStatus);
    Ok(())
}

// ───────────────────────────────────────── create

#[allow(clippy::too_many_arguments)]
pub fn validate_creation(
    arena: &mut Arena,
    now: i64,
    limits: &ProtocolLimits,
    rollover_in: u64,
) -> Result<()> {
    require!(
        arena.assets[0].mint != arena.assets[1].mint,
        TribeError::SameAsset
    );
    let duration = arena.end_ts - arena.start_ts;
    require!(
        duration >= limits.min_duration_secs && duration <= limits.max_duration_secs,
        TribeError::InvalidParams
    );
    require!(
        arena.start_ts >= now.saturating_add(limits.min_lead_secs),
        TribeError::TooLate
    );
    let p = &arena.params;
    require!(
        p.reward_split_ok() && p.min_hold_bps < 10_000,
        TribeError::InvalidParams
    );
    require!(
        arena.fee_policy.reward_pool_bps as u32
            + arena.fee_policy.protocol_bps as u32
            + arena.fee_policy.creator_bps as u32
            == 10_000
            && arena.fee_policy.fee_bps <= 10_000,
        TribeError::InvalidParams
    );
    arena.backing_close_ts = arena.end_ts - min_hold_secs(&arena.params, duration);
    require!(
        arena.backing_close_ts > arena.start_ts,
        TribeError::InvalidParams
    );
    arena.status = arena_status::SCHEDULED;
    arena.last_accrual_ts = arena.start_ts;
    arena.reward_pool_balance = rollover_in;
    arena.rollover_in = rollover_in;
    arena.settlement.winner = winner::NONE;
    Ok(())
}

impl ArenaParams {
    fn reward_split_ok(&self) -> bool {
        self.tie_bps <= 10_000
            && self.underdog.cap_q4 as u128 >= crate::engine::math::ONE_Q4
            && self.underdog.warmup_bps <= 10_000
    }
}

// ───────────────────────────────────────── fund

pub fn fund_pool(arena: &mut Arena, now: i64, amount: u64) -> Result<()> {
    require_status(arena, &[arena_status::SCHEDULED, arena_status::LIVE])?;
    require!(now < arena.end_ts, TribeError::TooLate);
    require!(amount > 0, TribeError::ZeroAmount);
    arena.reward_pool_balance = arena
        .reward_pool_balance
        .checked_add(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.sponsor_total = arena
        .sponsor_total
        .checked_add(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    Ok(())
}

// ───────────────────────────────────────── start

pub fn snapshot_start(arena: &mut Arena, now: i64, inputs: &[PriceInput; 2]) -> Result<()> {
    require_status(arena, &[arena_status::SCHEDULED])?;
    require!(now >= arena.start_ts, TribeError::TooEarly);
    require!(
        now <= arena
            .start_ts
            .saturating_add(arena.params.settlement_grace_secs),
        TribeError::TooLate
    );
    let a = validate_price_update(
        &inputs[0],
        &arena.assets[0],
        arena.start_ts,
        arena.allow_closed_settlement,
    )?;
    let b = validate_price_update(
        &inputs[1],
        &arena.assets[1],
        arena.start_ts,
        arena.allow_closed_settlement,
    )?;
    arena.start_prices = [a, b];
    arena.status = arena_status::LIVE;
    arena.last_accrual_ts = arena.start_ts;
    Ok(())
}

// ───────────────────────────────────────── back

pub struct BackOutcome {
    pub notional: u64,
    pub fee_required: u64,
    pub m_q4: u32,
    pub split: FeeSplit,
}

pub fn back(
    arena: &mut Arena,
    position: &mut Position,
    side: usize,
    units: u64,
    fee_paid: u64,
    now: i64,
) -> Result<BackOutcome> {
    require!(side < 2, TribeError::InvalidSide);
    require_status(arena, &[arena_status::LIVE])?;
    require!(now >= arena.start_ts, TribeError::TooEarly);
    require!(now < arena.backing_close_ts, TribeError::BackingClosed);
    require!(units > 0, TribeError::ZeroAmount);
    let vals = valuations(arena)?;
    let notional = notional_usdc(units, vals[side].price_q10, arena.assets[side].decimals)?;
    require!(
        notional >= arena.params.min_backing_usdc,
        TribeError::BelowMinimumBacking
    );
    let required = fee_required(notional, arena.fee_policy.fee_bps)?;
    require!(fee_paid >= required, TribeError::FeeTooLow);

    accrue_arena(arena, now)?;
    let w = arena.window();
    if position.deposits == 0 && position.units == 0 && position.entry_ts == 0 {
        position.entry_ts = now;
        position.last_touch_ts = now;
        position.side = side as u8;
    }
    accrue_position(position, now, &w)?;

    let m = underdog_multiplier(
        &arena.sides,
        &vals,
        side,
        units,
        now,
        arena.start_ts,
        arena.end_ts,
        &arena.params.underdog,
    )?;
    let m_q4 = u32::try_from(m.m_q4).map_err(|_| error!(TribeError::MathOverflow))?;
    apply_deposit(position, &mut arena.sides[side], units, m_q4, fee_paid)?;
    let split = split_fee(fee_paid, &arena.fee_policy, arena.creator_target)?;
    arena.reward_pool_balance = arena
        .reward_pool_balance
        .checked_add(split.to_pool)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.protocol_fees = arena
        .protocol_fees
        .checked_add(split.to_protocol)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.creator_fees = arena
        .creator_fees
        .checked_add(split.to_creator)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    Ok(BackOutcome {
        notional,
        fee_required: required,
        m_q4,
        split,
    })
}

// ───────────────────────────────────────── exit

pub fn exit(
    arena: &mut Arena,
    position: &mut Position,
    units: u64,
    now: i64,
) -> Result<ExitResult> {
    require_status(
        arena,
        &[
            arena_status::LIVE,
            arena_status::SETTLED,
            arena_status::CANCELLED,
        ],
    )?;
    let side = position.side as usize;
    require!(side < 2, TribeError::InvalidSide);
    let live = arena.status == arena_status::LIVE;
    if live {
        accrue_arena(arena, now)?;
        let w = arena.window();
        accrue_position(position, now, &w)?;
    }
    let forfeit = live && now < arena.end_ts;
    apply_exit(position, &mut arena.sides[side], units, forfeit)
}

// ───────────────────────────────────────── settle

pub struct SettleOutcome {
    pub winner: u8,
    pub upset_bonus: u64,
}

pub fn side_reward_denominator(side: &crate::state::SideState, m_settle_q4: u128) -> Result<u128> {
    Ok(side
        .eff_unit_seconds
        .min(mul_u128(side.reward_unit_seconds, m_settle_q4)?))
}

pub fn settle(
    arena: &mut Arena,
    now: i64,
    inputs: &[PriceInput; 2],
    reserve_balance: u64,
    limits: &ProtocolLimits,
) -> Result<SettleOutcome> {
    require!(
        arena.status != arena_status::SETTLED,
        TribeError::AlreadySettled
    );
    require_status(arena, &[arena_status::LIVE])?;
    require!(now >= arena.end_ts, TribeError::TooEarly);
    require!(now <= arena.settlement_deadline(), TribeError::TooLate);
    let ea = validate_price_update(
        &inputs[0],
        &arena.assets[0],
        arena.end_ts,
        arena.allow_closed_settlement,
    )?;
    let eb = validate_price_update(
        &inputs[1],
        &arena.assets[1],
        arena.end_ts,
        arena.allow_closed_settlement,
    )?;
    let sa = arena.start_prices[0].price_q10;
    let sb = arena.start_prices[1].price_q10;
    let w = decide_winner(sa, ea.price_q10, sb, eb.price_q10, arena.params.tie_bps)?;
    let perf_a = perf_bps(sa, ea.price_q10)?;
    let perf_b = perf_bps(sb, eb.price_q10)?;

    // Final accrual is clamped at end_ts regardless of how late the crank is.
    accrue_arena(arena, now)?;
    let vals = valuations(arena)?;

    let mut share_bps: u128 = 5000;
    let mut m_settle: u128 = crate::engine::math::ONE_Q4;
    let mut bonus: u64 = 0;
    let mut w_total: u128 = 0;
    let win = match w {
        WinnerSide::A => winner::A,
        WinnerSide::B => winner::B,
        WinnerSide::Tie => winner::TIE,
    };
    if win != winner::TIE {
        let side = win as usize;
        share_bps = settlement_twab_share_bps(&arena.sides, &vals, side)?;
        let u = compute_upset_bonus(
            share_bps,
            arena.reward_pool_balance,
            reserve_balance,
            &arena.params.underdog,
            limits.reserve_draw_bps,
            limits.upset_bonus_cap_usdc,
        )?;
        m_settle = u.m_upset_q4;
        bonus = u.bonus;
        w_total = side_reward_denominator(&arena.sides[side], m_settle)?;
    }
    let pool = arena
        .reward_pool_balance
        .checked_add(bonus)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.reward_pool_balance = pool;
    arena.end_prices = [ea, eb];
    arena.status = arena_status::SETTLED;
    arena.settlement = crate::state::SettlementRecord {
        winner: win,
        perf_bps_a: perf_a,
        perf_bps_b: perf_b,
        pool_at_settlement: pool,
        w_total,
        winner_twab_share_bps: share_bps as u16,
        m_settle_q4: m_settle as u32,
        upset_bonus: bonus,
        settled_at: now,
    };
    Ok(SettleOutcome {
        winner: win,
        upset_bonus: bonus,
    })
}

// ───────────────────────────────────────── claim

/// `W_i = min(eff_unit_seconds, unit_seconds × m_settle)` after final accrual
/// (computed without copying the position to keep the stack small).
pub fn position_reward_weight(arena: &Arena, p: &Position) -> Result<u128> {
    require!(
        arena.status == arena_status::SETTLED,
        TribeError::InvalidStatus
    );
    let w = arena.window();
    let until = arena.end_ts.max(p.last_touch_ts);
    let dt = accrual_delta(p.last_touch_ts, until, &w)?;
    let unit_seconds = add_u128(p.unit_seconds, mul_u128(p.units as u128, dt)?)?;
    let eff = add_u128(p.eff_unit_seconds, mul_u128(p.eff_units, dt)?)?;
    let clamp = mul_u128(unit_seconds, arena.settlement.m_settle_q4 as u128)?;
    Ok(eff.min(clamp))
}

pub fn payout_proportional(pool: u64, weight: u128, w_total: u128) -> Result<u64> {
    if w_total == 0 || weight == 0 {
        return Ok(0);
    }
    let v = crate::engine::math::mul_div(pool as u128, weight, w_total)?;
    crate::engine::math::to_u64(v)
}

/// Marks the position claimed and returns the payout; the caller transfers.
pub fn claim(arena: &mut Arena, position: &mut Position, now: i64) -> Result<u64> {
    require_status(arena, &[arena_status::SETTLED])?;
    let win = arena.settlement.winner;
    let pool = arena.settlement.pool_at_settlement;
    let w_total = arena.settlement.w_total;
    require!(win != winner::TIE, TribeError::NoWinner);
    require!(position.side == win, TribeError::NotWinningSide);
    require!(!position.claimed, TribeError::AlreadyClaimed);
    let w = arena.window();
    let until = arena.end_ts.max(position.last_touch_ts);
    accrue_position(position, until, &w)?;
    let weight = position_reward_weight(arena, position)?;
    require!(weight > 0, TribeError::NoRewardWeight);
    let amount = payout_proportional(pool, weight, w_total)?;
    require!(amount > 0, TribeError::NothingToClaim);
    require!(
        amount <= arena.reward_pool_balance,
        TribeError::InsufficientVault
    );
    position.claimed = true;
    arena.reward_pool_balance -= amount;
    arena.total_claimed = arena
        .total_claimed
        .checked_add(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    let _ = now;
    Ok(amount)
}

// ───────────────────────────────────────── cancel / extend / sweep

pub fn cancel_by_authority(arena: &mut Arena, now: i64) -> Result<()> {
    require_status(arena, &[arena_status::SCHEDULED, arena_status::LIVE])?;
    if arena.status == arena_status::LIVE {
        accrue_arena(arena, now)?;
    }
    arena.status = arena_status::CANCELLED;
    arena.cancel_reason = cancel_reason::AUTHORITY;
    Ok(())
}

pub fn cancel_expired(arena: &mut Arena, now: i64) -> Result<()> {
    require_status(arena, &[arena_status::SCHEDULED, arena_status::LIVE])?;
    if arena.status == arena_status::SCHEDULED {
        require!(
            now > arena
                .start_ts
                .saturating_add(arena.params.settlement_grace_secs),
            TribeError::NotExpired
        );
    } else {
        require!(now > arena.settlement_deadline(), TribeError::NotExpired);
        accrue_arena(arena, now)?;
    }
    arena.status = arena_status::CANCELLED;
    arena.cancel_reason = cancel_reason::EXPIRED;
    Ok(())
}

pub fn extend_settlement(
    arena: &mut Arena,
    now: i64,
    secs: i64,
    limits: &ProtocolLimits,
) -> Result<()> {
    require_status(arena, &[arena_status::LIVE])?;
    require!(now >= arena.end_ts, TribeError::TooEarly);
    require!(arena.extensions == 0, TribeError::AlreadyExtended);
    require!(
        secs > 0 && secs <= limits.max_extension_secs,
        TribeError::InvalidParams
    );
    arena.extensions = 1;
    arena.extension_secs = secs;
    Ok(())
}

/// Sponsor refund is available after cancellation or a TIE.
pub fn refund_available(arena: &Arena) -> bool {
    arena.status == arena_status::CANCELLED
        || (arena.status == arena_status::SETTLED && arena.settlement.winner == winner::TIE)
}

pub fn refund_sponsor(arena: &mut Arena, amount: u64) -> Result<()> {
    require!(refund_available(arena), TribeError::RefundNotAvailable);
    require!(
        amount <= arena.reward_pool_balance,
        TribeError::InsufficientVault
    );
    arena.reward_pool_balance -= amount;
    arena.sponsor_total = arena
        .sponsor_total
        .checked_sub(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    Ok(())
}

/// Returns the amount to move to rollover; on TIE the not-yet-refunded sponsor
/// money stays refundable.
pub fn sweep_unclaimed(arena: &mut Arena, now: i64, limits: &ProtocolLimits) -> Result<u64> {
    require_status(arena, &[arena_status::SETTLED])?;
    require!(
        now > arena
            .settlement
            .settled_at
            .saturating_add(limits.claim_window_secs),
        TribeError::TooEarly
    );
    require!(arena.claims_swept_at == 0, TribeError::InvalidStatus);
    let refundable = if arena.settlement.winner == winner::TIE {
        arena.sponsor_total
    } else {
        0
    };
    let amount = arena
        .reward_pool_balance
        .checked_sub(refundable)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.reward_pool_balance -= amount;
    arena.rollover_out = arena
        .rollover_out
        .checked_add(amount)
        .ok_or_else(|| error!(TribeError::MathOverflow))?;
    arena.claims_swept_at = now;
    Ok(amount)
}

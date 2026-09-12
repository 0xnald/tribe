import { assertU128, assertU64, clampBig, maxBig } from '../math/fixed';
import { ErrorCode, fail } from './errors';
import type { PositionState, SideState } from './types';

/**
 * Time-weighted conviction accumulators (ECONOMICS §5).
 *
 * Every function is pure, bigint-only, and written so it can be transcribed
 * line-by-line into the Anchor program. Timestamps are clamped into
 * `[startTs, endTs]` before differencing, so no time outside the Arena window
 * is ever counted and repeated accrual at the same timestamp is a no-op.
 */

export interface Window {
  startTs: bigint;
  endTs: bigint;
}

/** Clamp a timestamp into the accrual window. */
export function clampTs(ts: bigint, w: Window): bigint {
  return clampBig(ts, w.startTs, w.endTs);
}

/** Seconds of accrual between two raw timestamps, inside the window only. */
export function accrualDelta(lastTs: bigint, now: bigint, w: Window): bigint {
  if (now < lastTs) fail(ErrorCode.NonMonotonicClock, `now ${now} < last ${lastTs}`);
  const dt = clampTs(now, w) - clampTs(lastTs, w);
  return dt < 0n ? 0n : dt; // cannot be negative after clamping, defensive
}

/** Accrue a side aggregate by `dt` seconds. */
export function accrueSide(side: SideState, dt: bigint): SideState {
  if (dt === 0n) return side;
  return {
    ...side,
    unitSeconds: assertU128(side.unitSeconds + side.units * dt, 'side.unit_seconds'),
    effUnitSeconds: assertU128(side.effUnitSeconds + side.effUnits * dt, 'side.eff_unit_seconds'),
  };
}

/** Accrue a position up to `now`, updating its touch timestamp. */
export function accruePosition(p: PositionState, now: bigint, w: Window): PositionState {
  const dt = accrualDelta(p.lastTouchTs, now, w);
  return {
    ...p,
    unitSeconds: assertU128(p.unitSeconds + p.units * dt, 'position.unit_seconds'),
    effUnitSeconds: assertU128(p.effUnitSeconds + p.effUnits * dt, 'position.eff_unit_seconds'),
    lastTouchTs: maxBig(p.lastTouchTs, now),
  };
}

export function newPosition(
  owner: string,
  side: PositionState['side'],
  now: bigint,
): PositionState {
  return {
    owner,
    side,
    units: 0n,
    unitSeconds: 0n,
    effUnits: 0n,
    effUnitSeconds: 0n,
    entryTs: now,
    lastTouchTs: now,
    claimed: false,
    deposits: 0n,
    feePaid: 0n,
    forfeited: false,
  };
}

/**
 * Apply a deposit tranche of `units` at multiplier `mQ4` to an already-accrued
 * position and side (ECONOMICS §5.4).
 */
export function applyDeposit(
  p: PositionState,
  side: SideState,
  units: bigint,
  mQ4: bigint,
  feePaid: bigint,
): { position: PositionState; side: SideState } {
  if (units <= 0n) fail(ErrorCode.ZeroAmount);
  assertU64(units, 'units');
  const eff = assertU128(units * mQ4, 'eff_units');
  const isNew = p.units === 0n && p.deposits === 0n;
  return {
    position: {
      ...p,
      units: assertU64(p.units + units, 'position.units'),
      effUnits: assertU128(p.effUnits + eff, 'position.eff_units'),
      deposits: p.deposits + 1n,
      feePaid: p.feePaid + feePaid,
    },
    side: {
      ...side,
      units: assertU64(side.units + units, 'side.units'),
      effUnits: assertU128(side.effUnits + eff, 'side.eff_units'),
      participants: isNew ? side.participants + 1n : side.participants,
    },
  };
}

/**
 * Exit `x` units from an already-accrued position (ECONOMICS §5.5).
 *
 * When `forfeit` is true (now < endTs and Arena live) both live and accrued
 * weight are reduced proportionally; when false (after end_ts, or Arena
 * cancelled/settled) only units move and weight is untouched.
 */
export function applyExit(
  p: PositionState,
  side: SideState,
  x: bigint,
  forfeit: boolean,
): { position: PositionState; side: SideState; removedEff: bigint; removedEffSeconds: bigint } {
  if (x <= 0n) fail(ErrorCode.ZeroAmount);
  if (x > p.units) fail(ErrorCode.InsufficientUnits, `exit ${x} > held ${p.units}`);
  const u = p.units;
  const keepNum = u - x;
  let removedEff = 0n;
  let removedEffSeconds = 0n;
  let removedUnitSeconds = 0n;
  if (forfeit) {
    // removed = total − total × keep / u   (floor keeps the *kept* part rounded down,
    // so the forfeited part absorbs rounding — never favours the exiting user)
    removedEff = p.effUnits - (p.effUnits * keepNum) / u;
    removedEffSeconds = p.effUnitSeconds - (p.effUnitSeconds * keepNum) / u;
    removedUnitSeconds = p.unitSeconds - (p.unitSeconds * keepNum) / u;
  }
  const units = keepNum;
  return {
    position: {
      ...p,
      units,
      unitSeconds: p.unitSeconds - removedUnitSeconds,
      effUnits: p.effUnits - removedEff,
      effUnitSeconds: p.effUnitSeconds - removedEffSeconds,
      forfeited: p.forfeited || (forfeit && units === 0n),
    },
    side: {
      ...side,
      units: side.units - x,
      effUnits: side.effUnits - removedEff,
      effUnitSeconds: side.effUnitSeconds - removedEffSeconds,
    },
    removedEff,
    removedEffSeconds,
  };
}

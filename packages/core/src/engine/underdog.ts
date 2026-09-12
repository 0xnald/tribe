import type { UnderdogPolicy } from '../config/policy';
import { clampBig, maxBig, minBig } from '../math/fixed';
import { ErrorCode, fail } from './errors';
import { instantShareAfterDepositBps, twabShareBps, type ShareInputs } from './twab';
import type { SideId } from './types';

/**
 * Underdog multiplier (ECONOMICS §7.1–7.2), Q4 fixed point (10_000 = 1.0×).
 */

export const ONE_Q4 = 10_000n;

/** raw_m = clamp(1 + slope × (0.5 − share), 1, cap) in Q4. */
export function rawMultiplierQ4(shareEffBps: bigint, policy: UnderdogPolicy): bigint {
  const slope = BigInt(policy.slope);
  const cap = BigInt(policy.capQ4);
  const raw = ONE_Q4 + slope * (5000n - shareEffBps); // may be < ONE_Q4 when share > 50%
  return clampBig(raw, ONE_Q4, cap);
}

/** warmup_secs = max(duration × warmup_bps / 10_000, warmup_floor_secs). */
export function warmupSecs(durationSecs: bigint, policy: UnderdogPolicy): bigint {
  return maxBig(
    (durationSecs * BigInt(policy.warmupBps)) / 10_000n,
    BigInt(policy.warmupFloorSecs),
  );
}

/** Linear ramp of the boost over the warm-up window. */
export function rampMultiplierQ4(rawQ4: bigint, elapsedSecs: bigint, warmup: bigint): bigint {
  if (elapsedSecs < 0n) fail(ErrorCode.TooEarly, 'elapsed < 0');
  if (warmup === 0n) return rawQ4;
  const boost = rawQ4 - ONE_Q4;
  return ONE_Q4 + (boost * minBig(elapsedSecs, warmup)) / warmup;
}

export interface MultiplierInputs extends ShareInputs {
  side: SideId;
  depositUnits: bigint;
  now: bigint;
  startTs: bigint;
  endTs: bigint;
  policy: UnderdogPolicy;
}

export interface MultiplierResult {
  mQ4: bigint;
  rawQ4: bigint;
  shareInstBps: bigint;
  shareTwabBps: bigint | null;
  shareEffBps: bigint;
  warmup: bigint;
  elapsed: bigint;
}

/**
 * Multiplier for a tranche deposited now. Side aggregates must already be
 * accrued to `now`.
 *
 * share_eff = max(instant share after deposit, TWAB share before deposit);
 * when no time has accrued yet the TWAB is undefined and the instant share is
 * used alone (the warm-up ramp then neutralises it).
 */
export function underdogMultiplier(inp: MultiplierInputs): MultiplierResult {
  const shareInstBps = instantShareAfterDepositBps(inp, inp.side, inp.depositUnits);
  const shareTwab = twabShareBps(inp, inp.side);
  const shareEffBps = shareTwab === null ? shareInstBps : maxBig(shareInstBps, shareTwab);
  const rawQ4 = rawMultiplierQ4(shareEffBps, inp.policy);
  const warmup = warmupSecs(inp.endTs - inp.startTs, inp.policy);
  const elapsed = inp.now - inp.startTs;
  const mQ4 = rampMultiplierQ4(rawQ4, elapsed, warmup);
  return { mQ4, rawQ4, shareInstBps, shareTwabBps: shareTwab, shareEffBps, warmup, elapsed };
}

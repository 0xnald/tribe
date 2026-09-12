import type { UnderdogPolicy } from '../config/policy';
import { minBig } from '../math/fixed';
import { ErrorCode, fail } from './errors';
import { ONE_Q4, rawMultiplierQ4 } from './underdog';

/**
 * Upset Bonus (ECONOMICS §7.3): a pool-level top-up from the protocol Upset
 * Reserve when the winning side was the whole-Arena underdog. It never
 * touches principal and can never exceed what the reserve actually holds.
 */

export interface UpsetPolicy {
  underdog: UnderdogPolicy;
  /** Max fraction of the reserve one Arena may draw, bps. */
  reserveDrawBps: number;
  /** Absolute per-Arena cap in micro-USDC. */
  upsetBonusCapUsdc: bigint;
}

export interface UpsetInputs {
  /** Winner's whole-Arena TWAB share in bps. */
  winnerTwabShareBps: bigint;
  /** Fee- and sponsor-funded pool at settlement (before bonus). */
  basePool: bigint;
  /** Current reserve balance in micro-USDC. */
  reserveBalance: bigint;
  policy: UpsetPolicy;
}

export type UpsetLimiter = 'none' | 'formula' | 'reserveDraw' | 'reserveBalance' | 'cap';

export interface UpsetResult {
  mUpsetQ4: bigint;
  /** basePool × (m − 1) before limits. */
  requested: bigint;
  bonus: bigint;
  limitedBy: UpsetLimiter;
}

export function computeUpsetBonus(inp: UpsetInputs): UpsetResult {
  if (inp.basePool < 0n || inp.reserveBalance < 0n) fail(ErrorCode.InvalidParams, 'negative input');
  if (inp.winnerTwabShareBps < 0n || inp.winnerTwabShareBps > 10_000n) {
    fail(ErrorCode.InvalidParams, `share ${inp.winnerTwabShareBps} out of range`);
  }
  // No warm-up here: the whole-Arena integral is already the smoothing.
  const mUpsetQ4 = rawMultiplierQ4(inp.winnerTwabShareBps, inp.policy.underdog);
  const requested = (inp.basePool * (mUpsetQ4 - ONE_Q4)) / ONE_Q4;
  if (requested === 0n) return { mUpsetQ4, requested, bonus: 0n, limitedBy: 'formula' };

  const drawLimit = (inp.reserveBalance * BigInt(inp.policy.reserveDrawBps)) / 10_000n;
  const limits: Array<[bigint, UpsetLimiter]> = [
    [requested, 'none'],
    [inp.reserveBalance, 'reserveBalance'],
    [drawLimit, 'reserveDraw'],
    [inp.policy.upsetBonusCapUsdc, 'cap'],
  ];
  let bonus = requested;
  let limitedBy: UpsetLimiter = 'none';
  for (const [v, why] of limits) {
    if (v < bonus) {
      bonus = v;
      limitedBy = why;
    }
  }
  return { mUpsetQ4, requested, bonus: minBig(bonus, inp.reserveBalance), limitedBy };
}

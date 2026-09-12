import type { FeePolicy } from '../config/policy';
import { assertU64 } from '../math/fixed';
import { ErrorCode, fail } from './errors';

/**
 * Fee engine (ECONOMICS §3). Micro-USDC integers throughout.
 */

/** fee_required = notional × fee_bps / 10_000 (floor). */
export function feeRequired(notionalUsdc: bigint, feeBps: number): bigint {
  if (notionalUsdc < 0n) fail(ErrorCode.InvalidParams, 'negative notional');
  return (notionalUsdc * BigInt(feeBps)) / 10_000n;
}

/** Client-side charge for USDC entries: never below 0.50 % of USDC actually spent. */
export function feeCharged(notionalUsdc: bigint, usdcIn: bigint, feeBps: number): bigint {
  const a = feeRequired(notionalUsdc, feeBps);
  const b = feeRequired(usdcIn, feeBps);
  return a > b ? a : b;
}

export interface FeeSplitResult {
  toPool: bigint;
  toProtocol: bigint;
  toCreator: bigint;
  /** Where the creator share actually went. */
  creatorRoutedTo: 'Creator' | 'Protocol' | 'RewardPool';
}

/**
 * Split a paid fee. The protocol share absorbs rounding so
 * `toPool + toProtocol + toCreator == feePaid` exactly.
 */
export function splitFee(feePaid: bigint, policy: FeePolicy): FeeSplitResult {
  assertU64(feePaid, 'fee_paid');
  const pool = (feePaid * BigInt(policy.split.rewardPoolBps)) / 10_000n;
  const creator = (feePaid * BigInt(policy.split.creatorBps)) / 10_000n;
  const protocol = feePaid - pool - creator;
  switch (policy.creatorShareTarget) {
    case 'Creator':
      return { toPool: pool, toProtocol: protocol, toCreator: creator, creatorRoutedTo: 'Creator' };
    case 'Protocol':
      return {
        toPool: pool,
        toProtocol: protocol + creator,
        toCreator: 0n,
        creatorRoutedTo: 'Protocol',
      };
    case 'RewardPool':
      return {
        toPool: pool + creator,
        toProtocol: protocol,
        toCreator: 0n,
        creatorRoutedTo: 'RewardPool',
      };
  }
}

import { describe, expect, it } from 'vitest';

import { DEFAULT_FEE_POLICY, type FeePolicy } from '../config/policy';
import { feeCharged, feeRequired, splitFee } from './fees';

const P = DEFAULT_FEE_POLICY;

describe('feeRequired', () => {
  it('is 0.50 % floored', () => {
    expect(feeRequired(100_000_000n, 50)).toBe(500_000n);
    expect(feeRequired(99_999_999n, 50)).toBe(499_999n);
    expect(feeRequired(5_000_000n, 50)).toBe(25_000n);
  });
  it('tiny notionals round to zero fee (below minimum backing anyway)', () => {
    expect(feeRequired(199n, 50)).toBe(0n);
    expect(feeRequired(200n, 50)).toBe(1n);
  });
  it('rejects negative notional', () => {
    expect(() => feeRequired(-1n, 50)).toThrow();
  });
  it('is configurable', () => {
    expect(feeRequired(100_000_000n, 0)).toBe(0n);
    expect(feeRequired(100_000_000n, 10_000)).toBe(100_000_000n);
  });
});

describe('feeCharged', () => {
  it('never below the fee on USDC actually spent', () => {
    // notional at start price is $99.85 but the user spent $100.20 (slippage) → charge on $100.20
    expect(feeCharged(99_850_000n, 100_200_000n, 50)).toBe(501_000n);
    // asset rallied since start: notional at start price is lower than spend → still on spend
    expect(feeCharged(80_000_000n, 100_000_000n, 50)).toBe(500_000n);
    // asset fell: on-chain requirement (start notional) dominates
    expect(feeCharged(120_000_000n, 100_000_000n, 50)).toBe(600_000n);
  });
});

describe('splitFee', () => {
  it('splits 40/40/20 exactly with protocol absorbing rounding', () => {
    const r = splitFee(500_000n, P);
    expect(r).toEqual({
      toPool: 200_000n,
      toProtocol: 200_000n,
      toCreator: 100_000n,
      creatorRoutedTo: 'Creator',
    });
    const odd = splitFee(7n, P);
    expect(odd.toPool).toBe(2n); // floor(2.8)
    expect(odd.toCreator).toBe(1n); // floor(1.4)
    expect(odd.toProtocol).toBe(4n); // 7 − 2 − 1
    expect(odd.toPool + odd.toProtocol + odd.toCreator).toBe(7n);
  });
  it('routes the creator share for first-party Arenas', () => {
    const toPool: FeePolicy = { ...P, creatorShareTarget: 'RewardPool' };
    const toProto: FeePolicy = { ...P, creatorShareTarget: 'Protocol' };
    expect(splitFee(500_000n, toPool)).toEqual({
      toPool: 300_000n,
      toProtocol: 200_000n,
      toCreator: 0n,
      creatorRoutedTo: 'RewardPool',
    });
    expect(splitFee(500_000n, toProto)).toEqual({
      toPool: 200_000n,
      toProtocol: 300_000n,
      toCreator: 0n,
      creatorRoutedTo: 'Protocol',
    });
  });
  it('conserves every micro-USDC across a sweep of small fees', () => {
    for (let f = 0n; f < 1000n; f++) {
      const r = splitFee(f, P);
      expect(r.toPool + r.toProtocol + r.toCreator).toBe(f);
      expect(r.toPool).toBeLessThanOrEqual(f);
      expect(r.toProtocol).toBeGreaterThanOrEqual(0n);
    }
  });
  it('rejects negative fee', () => {
    expect(() => splitFee(-1n, P)).toThrow();
  });
});

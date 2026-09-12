import { describe, expect, it } from 'vitest';

import {
  ArenaParamsSchema,
  DEFAULT_ARENA_PARAMS,
  DEFAULT_FEE_POLICY,
  DEFAULT_PROTOCOL_LIMITS,
  FeePolicySchema,
  FeeSplitSchema,
} from './policy';

describe('FeePolicy', () => {
  it('defaults match ECONOMICS §3', () => {
    expect(DEFAULT_FEE_POLICY.feeBps).toBe(50);
    expect(DEFAULT_FEE_POLICY.split).toEqual({
      rewardPoolBps: 4000,
      protocolBps: 4000,
      creatorBps: 2000,
    });
  });
  it('rejects splits that do not sum to 100%', () => {
    expect(
      FeeSplitSchema.safeParse({ rewardPoolBps: 4000, protocolBps: 4000, creatorBps: 1000 })
        .success,
    ).toBe(false);
    expect(
      FeeSplitSchema.safeParse({ rewardPoolBps: 5000, protocolBps: 5000, creatorBps: 1000 })
        .success,
    ).toBe(false);
  });
  it('rejects out-of-range fee', () => {
    expect(FeePolicySchema.safeParse({ ...DEFAULT_FEE_POLICY, feeBps: 10_001 }).success).toBe(
      false,
    );
    expect(FeePolicySchema.safeParse({ ...DEFAULT_FEE_POLICY, feeBps: -1 }).success).toBe(false);
  });
});

describe('ArenaParams', () => {
  it('defaults match ECONOMICS §12', () => {
    expect(DEFAULT_ARENA_PARAMS.tieBps).toBe(1);
    expect(DEFAULT_ARENA_PARAMS.minHoldBps).toBe(1000);
    expect(DEFAULT_ARENA_PARAMS.minHoldFloorSecs).toBe(900);
    expect(DEFAULT_ARENA_PARAMS.underdog).toEqual({
      slope: 2,
      capQ4: 20_000,
      warmupBps: 1000,
      warmupFloorSecs: 1800,
    });
    expect(DEFAULT_ARENA_PARAMS.maxShareBps).toBe(2500);
    expect(DEFAULT_ARENA_PARAMS.minBackingUsdc).toBe(5_000_000n);
  });
  it('rejects a zero share cap', () => {
    expect(ArenaParamsSchema.safeParse({ ...DEFAULT_ARENA_PARAMS, maxShareBps: 0 }).success).toBe(
      false,
    );
  });
});

describe('ProtocolLimits', () => {
  it('has sane ordering', () => {
    expect(DEFAULT_PROTOCOL_LIMITS.minDurationSecs).toBeLessThan(
      DEFAULT_PROTOCOL_LIMITS.maxDurationSecs,
    );
    expect(DEFAULT_PROTOCOL_LIMITS.upsetBonusCapUsdc).toBe(5_000_000_000n);
  });
});

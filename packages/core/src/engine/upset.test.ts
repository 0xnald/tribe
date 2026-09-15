import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_PARAMS, DEFAULT_PROTOCOL_LIMITS } from '../config/policy';
import {
  DAY,
  HOUR,
  TSLA_PRICE_Q10,
  arenaConfig,
  harness,
  unitsForUsd,
  BONK_PRICE_Q10,
} from '../testing/fixtures';
import { computeUpsetBonus, type UpsetPolicy } from './upset';

const POLICY: UpsetPolicy = {
  underdog: DEFAULT_ARENA_PARAMS.underdog,
  reserveDrawBps: DEFAULT_PROTOCOL_LIMITS.reserveDrawBps,
  upsetBonusCapUsdc: DEFAULT_PROTOCOL_LIMITS.upsetBonusCapUsdc,
};
const POOL = 4_000_000_000n; // 4 000 USDC

describe('computeUpsetBonus', () => {
  it('favourite wins → no bonus', () => {
    const r = computeUpsetBonus({
      winnerTwabShareBps: 7000n,
      basePool: POOL,
      reserveBalance: 10n ** 12n,
      policy: POLICY,
    });
    expect(r.mUpsetQ4).toBe(10_000n);
    expect(r.bonus).toBe(0n);
    expect(r.limitedBy).toBe('formula');
  });
  it('20 % underdog wins → +60 % of pool, from a deep reserve', () => {
    const r = computeUpsetBonus({
      winnerTwabShareBps: 2000n,
      basePool: POOL,
      reserveBalance: 10n ** 12n,
      policy: POLICY,
    });
    expect(r.mUpsetQ4).toBe(16_000n);
    expect(r.requested).toBe(2_400_000_000n);
    expect(r.bonus).toBe(2_400_000_000n);
    expect(r.limitedBy).toBe('none');
  });
  it('is capped by reserve draw, then by absolute cap, then by balance', () => {
    // draw limit 10 % of a 10 000 USDC reserve = 1 000
    let r = computeUpsetBonus({
      winnerTwabShareBps: 2000n,
      basePool: POOL,
      reserveBalance: 10_000_000_000n,
      policy: POLICY,
    });
    expect(r.bonus).toBe(1_000_000_000n);
    expect(r.limitedBy).toBe('reserveDraw');
    // absolute cap 5 000 USDC with a huge pool
    r = computeUpsetBonus({
      winnerTwabShareBps: 1000n,
      basePool: 100_000_000_000n,
      reserveBalance: 10n ** 13n,
      policy: POLICY,
    });
    expect(r.bonus).toBe(5_000_000_000n);
    expect(r.limitedBy).toBe('cap');
    // insufficient reserve: never exceeds what is actually there
    r = computeUpsetBonus({
      winnerTwabShareBps: 2000n,
      basePool: POOL,
      reserveBalance: 5n,
      policy: { ...POLICY, reserveDrawBps: 10_000 },
    });
    expect(r.bonus).toBe(5n);
    expect(r.limitedBy).toBe('reserveBalance');
    // empty reserve → zero bonus, explicit
    r = computeUpsetBonus({
      winnerTwabShareBps: 2000n,
      basePool: POOL,
      reserveBalance: 0n,
      policy: POLICY,
    });
    expect(r.bonus).toBe(0n);
    expect(r.limitedBy).toBe('reserveBalance');
  });
  it('rejects out-of-range inputs', () => {
    expect(() =>
      computeUpsetBonus({
        winnerTwabShareBps: 10_001n,
        basePool: POOL,
        reserveBalance: 0n,
        policy: POLICY,
      }),
    ).toThrow();
    expect(() =>
      computeUpsetBonus({
        winnerTwabShareBps: 2000n,
        basePool: -1n,
        reserveBalance: 0n,
        policy: POLICY,
      }),
    ).toThrow();
  });
});

describe('upset bonus through settlement (manipulation)', () => {
  it('uses the whole-Arena TWAB, so a last-minute pile-on cannot fake an upset', () => {
    const h = harness(arenaConfig());
    h.start();
    const t0 = h.state.config.startTs;
    h.back('a', 'A', unitsForUsd(h.state, 'A', 10_000n), t0);
    h.back('b', 'B', unitsForUsd(h.state, 'B', 10_000n), t0);
    // just before cutoff, a whale makes A look like the 90 % favourite
    h.back('whale', 'A', unitsForUsd(h.state, 'A', 80_000n), h.state.backingCloseTs - 1n);
    h.settle({ A: BONK_PRICE_Q10, B: TSLA_PRICE_Q10 + 10n ** 11n }, undefined, 10n ** 12n); // B wins
    const st = h.state.settlement;
    if (!st) throw new Error('no settlement');
    // TWAB share of B ≈ 10k×24h / (10k×24h + 10k×24h + 80k×2.4h) ≈ 35 % → m ≈ 1.29×, not 1.8×
    expect(st.winnerTwabShareBps).toBeGreaterThan(3400n);
    expect(st.winnerTwabShareBps).toBeLessThan(3600n);
    expect(st.mSettleQ4).toBeLessThan(13_500n);
    expect(st.upsetBonus).toBe(
      ((h.state.rewardVault - st.upsetBonus) * (st.mSettleQ4 - 10_000n)) / 10_000n,
    );
  });
  it('never adds liabilities beyond the reserve and never touches positions', () => {
    const h = harness(arenaConfig({ durationSecs: 2n * DAY }));
    h.start();
    const t0 = h.state.config.startTs;
    h.back('crowd', 'A', unitsForUsd(h.state, 'A', 90_000n), t0);
    h.back('lonely', 'B', unitsForUsd(h.state, 'B', 10_000n), t0 + HOUR);
    const unitsBefore = h.state.positions['B:lonely']?.units;
    h.settle({ A: BONK_PRICE_Q10, B: TSLA_PRICE_Q10 + 10n ** 11n }, undefined, 100_000_000n); // reserve 100 USDC
    const st = h.state.settlement;
    if (!st) throw new Error('no settlement');
    expect(st.upsetBonus).toBeLessThanOrEqual(10_000_000n); // ≤ 10 % draw of 100 USDC
    expect(st.poolAtSettlement).toBe(h.state.rewardVault);
    expect(h.state.positions['B:lonely']?.units).toBe(unitsBefore);
  });
});

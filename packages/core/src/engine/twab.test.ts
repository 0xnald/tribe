import { describe, expect, it } from 'vitest';

import {
  HOUR,
  TSLA_PRICE_Q10,
  arenaConfig,
  harness,
  unitsForUsd,
  BONK_PRICE_Q10,
} from '../testing/fixtures';
import { accrueSide } from './accrual';
import {
  instantShareAfterDepositBps,
  settlementTwabShareBps,
  sideUsd,
  sideUsdSeconds,
  twabShareBps,
} from './twab';
import { ZERO_SIDE } from './types';

const V = {
  A: { priceQ10: 28_100n, decimals: 5 }, // BONK
  B: { priceQ10: TSLA_PRICE_Q10, decimals: 8 }, // TSLAx
};

describe('side valuation', () => {
  it('normalises across very different decimals and prices', () => {
    // $100 of each: 35,587,188.61 BONK (3_558_718_861 units) vs 0.27378508 TSLAx
    const a = sideUsd({ ...ZERO_SIDE, units: 3_558_718_861_209n }, V.A);
    const b = sideUsd({ ...ZERO_SIDE, units: 27_378_508n }, V.B);
    // both ≈ 100 × 1e10 (USD × 1e10 scale)
    expect(a / 100_000_000n).toBeGreaterThanOrEqual(9999n);
    expect(a / 100_000_000n).toBeLessThanOrEqual(10_000n);
    expect(b / 100_000_000n).toBeGreaterThanOrEqual(9999n);
    expect(b / 100_000_000n).toBeLessThanOrEqual(10_000n);
  });
});

describe('shares', () => {
  it('instant share counts the deposit; TWAB is undefined with no accrued time', () => {
    const sides = { A: { ...ZERO_SIDE, units: 3_558_718_861_209n }, B: { ...ZERO_SIDE } };
    const inst = instantShareAfterDepositBps({ sides, valuations: V }, 'B', 27_378_508n);
    expect(inst).toBeGreaterThanOrEqual(4999n);
    expect(inst).toBeLessThanOrEqual(5000n);
    expect(twabShareBps({ sides, valuations: V }, 'B')).toBeNull();
    expect(settlementTwabShareBps({ sides, valuations: V }, 'B')).toBe(5000n);
  });
  it('TWAB follows time, not the last snapshot', () => {
    let A = { ...ZERO_SIDE, units: 3_558_718_861_209n }; // $100
    let B = { ...ZERO_SIDE, units: 27_378_508n }; // $100
    A = accrueSide(A, 3n * HOUR);
    B = accrueSide(B, 3n * HOUR);
    // whale drops $900 onto B for one second
    B = { ...B, units: B.units + 27_378_508n * 9n };
    A = accrueSide(A, 1n);
    B = accrueSide(B, 1n);
    const inst = instantShareAfterDepositBps({ sides: { A, B }, valuations: V }, 'A', 1n);
    const twab = twabShareBps({ sides: { A, B }, valuations: V }, 'A');
    expect(inst).toBeLessThan(1100n); // ≈ 10 %
    expect(twab).toBeGreaterThan(4990n); // still ≈ 50 %
  });
  it('sideUsdSeconds is exactly units × Δt × price / 10^d', () => {
    const A = accrueSide({ ...ZERO_SIDE, units: 1_000_000n }, 10n);
    expect(sideUsdSeconds(A, V.A)).toBe((10_000_000n * 28_100n) / 100_000n);
  });
});

describe('TWAB sequences through the reducer', () => {
  it('deposits, exits, idle periods, same-timestamp updates, cutoff and exact end', () => {
    const h = harness(arenaConfig());
    h.start();
    const c = h.state.config;
    const t0 = c.startTs;
    const uA = unitsForUsd(h.state, 'A', 100n);
    const uB = unitsForUsd(h.state, 'B', 100n);
    h.back('a1', 'A', uA, t0);
    h.back('b1', 'B', uB, t0);
    h.back('a2', 'A', uA, t0); // same timestamp: no accrual between
    expect(h.state.sides.A.unitSeconds).toBe(0n);
    // long idle
    h.back('b2', 'B', uB, t0 + 10n * HOUR);
    expect(h.state.sides.A.unitSeconds).toBe(2n * uA * 10n * HOUR);
    expect(h.state.sides.B.unitSeconds).toBe(uB * 10n * HOUR);
    // exit half of a1 at +12h: the side TWAB is history and is NOT rewritten,
    // but the side's reward denominator (eff_unit_seconds) drops by a1's forfeited half
    const twabBefore = h.state.sides.A.unitSeconds + 2n * uA * 2n * HOUR;
    const effBefore = h.state.sides.A.effUnitSeconds + h.state.sides.A.effUnits * 2n * HOUR;
    h.exit('a1', 'A', uA / 2n, t0 + 12n * HOUR);
    const a1 = h.state.positions['A:a1'];
    if (!a1) throw new Error('missing');
    expect(h.state.sides.A.units).toBe(2n * uA - uA / 2n);
    expect(h.state.sides.A.unitSeconds).toBe(twabBefore);
    expect(h.state.sides.A.effUnitSeconds).toBeLessThan(effBefore);
    // deposit exactly at cutoff − 1 accepted, at cutoff rejected — TWAB unaffected by rejection
    const close = h.state.backingCloseTs;
    h.back('a3', 'A', uA, close - 1n);
    const snapshot = h.state.sides.A.unitSeconds;
    expect(() => h.back('a4', 'A', uA, close)).toThrow();
    expect(h.state.sides.A.unitSeconds).toBe(snapshot);
    // settle exactly at end: final accrual reaches end_ts and never beyond
    h.settle({ A: BONK_PRICE_Q10, B: TSLA_PRICE_Q10 }, c.endTs);
    const totalA = h.state.sides.A.effUnitSeconds;
    // recompute the reward denominator from positions: Σ eff_units_i × held_i
    let expected = 0n;
    for (const p of Object.values(h.state.positions)) {
      if (p.side !== 'A') continue;
      expected +=
        p.effUnitSeconds +
        p.effUnits * (c.endTs - (p.lastTouchTs > c.endTs ? c.endTs : p.lastTouchTs));
    }
    expect(totalA).toBe(expected);
    // an exit after end changes neither the TWAB nor the denominator
    const twabAtEnd = h.state.sides.A.unitSeconds;
    h.exit('a3', 'A', uA, c.endTs + 5n * HOUR);
    expect(h.state.sides.A.effUnitSeconds).toBe(totalA);
    expect(h.state.sides.A.unitSeconds).toBe(twabAtEnd);
  });
});

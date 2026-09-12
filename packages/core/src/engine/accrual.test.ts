import { describe, expect, it } from 'vitest';

import { MathError } from '../math/fixed';
import {
  accrualDelta,
  accruePosition,
  accrueSide,
  applyDeposit,
  applyExit,
  clampTs,
  newPosition,
} from './accrual';
import { ErrorCode, TribeError } from './errors';
import { ZERO_SIDE } from './types';

const W = { startTs: 1000n, endTs: 1000n + 86_400n };
const ONE = 10_000n;

describe('clamp / delta', () => {
  it('clamps into the window', () => {
    expect(clampTs(0n, W)).toBe(1000n);
    expect(clampTs(5000n, W)).toBe(5000n);
    expect(clampTs(10n ** 9n, W)).toBe(W.endTs);
  });
  it('counts no time before start or after end', () => {
    expect(accrualDelta(0n, 999n, W)).toBe(0n);
    expect(accrualDelta(0n, 1000n, W)).toBe(0n);
    expect(accrualDelta(0n, 1001n, W)).toBe(1n);
    expect(accrualDelta(W.endTs, W.endTs + 5000n, W)).toBe(0n);
    expect(accrualDelta(W.endTs - 10n, W.endTs + 5000n, W)).toBe(10n);
  });
  it('rejects non-monotonic clocks', () => {
    expect(() => accrualDelta(2000n, 1999n, W)).toThrow(TribeError);
    try {
      accrualDelta(2000n, 1999n, W);
    } catch (e) {
      expect((e as TribeError).code).toBe(ErrorCode.NonMonotonicClock);
    }
  });
});

describe('accrueSide / accruePosition', () => {
  it('accrues units × dt and eff_units × dt', () => {
    const side = { ...ZERO_SIDE, units: 100n, effUnits: 100n * ONE };
    const s = accrueSide(side, 10n);
    expect(s.unitSeconds).toBe(1000n);
    expect(s.effUnitSeconds).toBe(1000n * ONE);
  });
  it('repeated accrual at the same timestamp does not double count', () => {
    let p = newPosition('u', 'A', 1000n);
    p = applyDeposit(p, ZERO_SIDE, 100n, ONE, 0n).position;
    p = accruePosition(p, 2000n, W);
    const once = p.effUnitSeconds;
    p = accruePosition(p, 2000n, W);
    p = accruePosition(p, 2000n, W);
    expect(p.effUnitSeconds).toBe(once);
    expect(once).toBe(100n * ONE * 1000n);
  });
  it('a position touched after end never accrues more', () => {
    let p = newPosition('u', 'A', 1000n);
    p = applyDeposit(p, ZERO_SIDE, 5n, ONE, 0n).position;
    p = accruePosition(p, W.endTs + 100n, W);
    const atEnd = p.effUnitSeconds;
    p = accruePosition(p, W.endTs + 10_000n, W);
    expect(p.effUnitSeconds).toBe(atEnd);
    expect(atEnd).toBe(5n * ONE * 86_400n);
  });
});

describe('applyDeposit', () => {
  it('rejects zero and overflow', () => {
    const p = newPosition('u', 'A', 1000n);
    expect(() => applyDeposit(p, ZERO_SIDE, 0n, ONE, 0n)).toThrow(TribeError);
    expect(() => applyDeposit(p, ZERO_SIDE, 1n << 64n, ONE, 0n)).toThrow(MathError);
  });
  it('increments participants only on the first deposit of a position', () => {
    const p0 = newPosition('u', 'A', 1000n);
    const r1 = applyDeposit(p0, ZERO_SIDE, 10n, ONE, 0n);
    expect(r1.side.participants).toBe(1n);
    const r2 = applyDeposit(r1.position, r1.side, 10n, 15_000n, 0n);
    expect(r2.side.participants).toBe(1n);
    expect(r2.position.effUnits).toBe(10n * ONE + 10n * 15_000n);
    expect(r2.side.effUnits).toBe(r2.position.effUnits);
  });
});

describe('applyExit', () => {
  function seeded() {
    let p = newPosition('u', 'A', 1000n);
    let side = ZERO_SIDE;
    ({ position: p, side } = applyDeposit(p, side, 100n, ONE, 0n));
    p = accruePosition(p, 11_000n, W); // 10 000 s
    side = accrueSide(side, 10_000n);
    return { p, side };
  }

  it('partial exit reduces live and accrued weight proportionally', () => {
    const { p, side } = seeded();
    const r = applyExit(p, side, 25n, true);
    expect(r.position.units).toBe(75n);
    expect(r.position.effUnits).toBe(75n * ONE);
    expect(r.position.effUnitSeconds).toBe(75n * ONE * 10_000n);
    expect(r.side.effUnitSeconds).toBe(r.position.effUnitSeconds);
    expect(r.removedEffSeconds).toBe(25n * ONE * 10_000n);
  });
  it('full exit before end forfeits everything', () => {
    const { p, side } = seeded();
    const r = applyExit(p, side, 100n, true);
    expect(r.position.units).toBe(0n);
    expect(r.position.effUnits).toBe(0n);
    expect(r.position.effUnitSeconds).toBe(0n);
    expect(r.position.forfeited).toBe(true);
    expect(r.side.effUnitSeconds).toBe(0n);
  });
  it('exit after end moves units only', () => {
    const { p, side } = seeded();
    const r = applyExit(p, side, 100n, false);
    expect(r.position.units).toBe(0n);
    expect(r.position.effUnitSeconds).toBe(p.effUnitSeconds);
    expect(r.position.forfeited).toBe(false);
    expect(r.side.effUnitSeconds).toBe(side.effUnitSeconds);
  });
  it('rounding never favours the exiting user', () => {
    // 3 units, 7 unit-seconds accrued (odd), exit 1 → keep 2/3 → floor(7×2/3)=4 kept, 3 removed
    let p = newPosition('u', 'A', 1000n);
    p = { ...applyDeposit(p, ZERO_SIDE, 3n, ONE, 0n).position, effUnitSeconds: 7n };
    const r = applyExit(
      p,
      { ...ZERO_SIDE, units: 3n, effUnits: 3n * ONE, effUnitSeconds: 7n },
      1n,
      true,
    );
    expect(r.position.effUnitSeconds).toBe(4n);
    expect(r.removedEffSeconds).toBe(3n);
  });
  it('rejects zero, negative and over-withdrawal', () => {
    const { p, side } = seeded();
    expect(() => applyExit(p, side, 0n, true)).toThrow(TribeError);
    expect(() => applyExit(p, side, -1n, true)).toThrow(TribeError);
    expect(() => applyExit(p, side, 101n, true)).toThrow(TribeError);
  });
  it('sequence of partial exits is order-consistent and never negative', () => {
    let { p, side } = seeded();
    for (const x of [10n, 30n, 59n, 1n]) {
      ({ position: p, side } = applyExit(p, side, x, true));
      expect(p.effUnitSeconds).toBeGreaterThanOrEqual(0n);
      expect(side.effUnitSeconds).toBe(p.effUnitSeconds);
    }
    expect(p.units).toBe(0n);
    expect(p.effUnitSeconds).toBe(0n);
  });
});

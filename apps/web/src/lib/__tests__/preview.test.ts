import { describe, expect, it } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena } from '../arena/fixtures';
import { buildPreview } from '../back/preview';

const NOW = 1_789_300_000;
const arena = buildFixtureArena(FIXTURE_DEFS[1]!, NOW); // SOL vs SPYx, live

describe('back preview', () => {
  it('charges exactly 0.50 % on a USDC buy and totals notional + fee', () => {
    const p = buildPreview({ arena, side: 'a', method: 'usdc', amount: 100, now: NOW });
    expect(p.notionalUsd).toBe(100);
    expect(p.feeUsd).toBe(0.5);
    expect(p.totalUsdc).toBe(100.5);
    expect(p.feeSplit.pool + p.feeSplit.protocol + p.feeSplit.creator).toBeCloseTo(0.5, 9);
    expect(p.units).toBeCloseTo(100 / arena.sides[0].price, 9);
  });
  it('uses the live quote for units when provided', () => {
    const p = buildPreview({
      arena,
      side: 'a',
      method: 'usdc',
      amount: 100,
      now: NOW,
      quotedUnits: 0.42,
    });
    expect(p.units).toBe(0.42);
  });
  it('values existing holdings at the Arena price and charges the fee only', () => {
    const p = buildPreview({ arena, side: 'b', method: 'holdings', amount: 2, now: NOW });
    expect(p.notionalUsd).toBeCloseTo(2 * arena.sides[1].price, 9);
    expect(p.totalUsdc).toBe(p.feeUsd);
  });
  it('flags amounts below the minimum and never guarantees rewards', () => {
    const p = buildPreview({ arena, side: 'a', method: 'usdc', amount: 3, now: NOW });
    expect(p.belowMinimum).toBe(true);
    expect(p.estShare).toBeGreaterThan(0);
    expect(p.estShare).toBeLessThan(1);
    expect(p.estRewardUsd).toBeLessThanOrEqual(arena.rewardPoolUsd);
  });
  it('underdog side gets the multiplier in its weight', () => {
    const fav = arena.sides[0].backingShare > 0.5 ? 'a' : 'b';
    const dog = fav === 'a' ? 'b' : 'a';
    const pf = buildPreview({ arena, side: fav, method: 'usdc', amount: 100, now: NOW });
    const pd = buildPreview({ arena, side: dog, method: 'usdc', amount: 100, now: NOW });
    expect(pd.multiplier).toBeGreaterThan(pf.multiplier);
    expect(pd.weight).toBeGreaterThan(pf.weight);
  });
});

import { describe, expect, it } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena } from '../arena/fixtures';
import { arenaCountdown, isBackable } from '../arena/model';
import { positionInsight, type PositionRecord } from '../positions/model';

const NOW = 1_789_300_000;

function rec(over: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 'p1',
    provenance: 'demo',
    arenaSlug: 'bonk-vs-tslax',
    arenaId: 'demo:bonk-vs-tslax',
    side: 'b',
    units: 1,
    entryTs: NOW - 6 * 3600,
    usdAtEntry: 360,
    feeUsd: 1.8,
    multiplierAtEntry: 1.4,
    status: 'active',
    ...over,
  };
}

describe('position insight', () => {
  const arena = buildFixtureArena(FIXTURE_DEFS[0]!, NOW); // BONK leads TSLAx

  it('separates the asset move from the Arena result', () => {
    const ins = positionInsight(rec(), arena, NOW);
    // TSLAx side trails BONK in the Arena...
    expect(ins.leading).toBe(false);
    expect(ins.leadPct).toBeLessThan(0);
    // ...while the asset itself is up since entry (paid 360, worth 365.25 x perf)
    expect(ins.valueUsd).toBeCloseTo(arena.sides[1].price, 6);
    expect(ins.ownPct).toBeCloseTo(((arena.sides[1].price - 360) / 360) * 100, 6);
    expect(ins.ownPct).toBeGreaterThan(0);
    expect(ins.bucket).toBe('active');
    expect(ins.timeHeldSecs).toBe(6 * 3600);
  });

  it('weights by usd x hours x multiplier and estimates a bounded share', () => {
    const ins = positionInsight(rec(), arena, NOW);
    expect(ins.weight).toBeCloseTo(360 * 6 * 1.4, 6);
    expect(ins.estShare).toBeGreaterThan(0);
    expect(ins.estShare).toBeLessThan(1);
  });

  it('settled: winners are claimable, losers completed with no reward', () => {
    const def = FIXTURE_DEFS.find((d) => d.slug === 'bonk-vs-tslax-round-1')!;
    const settled = buildFixtureArena(def, NOW);
    expect(settled.status).toBe('settled');
    const winner = settled.winner as 'a' | 'b';
    const loser = winner === 'a' ? 'b' : 'a';
    const w = positionInsight(
      rec({ arenaSlug: settled.slug, side: winner, entryTs: settled.startTs }),
      settled,
      NOW,
    );
    const l = positionInsight(
      rec({ arenaSlug: settled.slug, side: loser, entryTs: settled.startTs }),
      settled,
      NOW,
    );
    expect(w.bucket).toBe('claimable');
    expect(w.won).toBe(true);
    expect(w.estRewardUsd).toBeGreaterThan(0);
    expect(l.bucket).toBe('completed');
    expect(l.won).toBe(false);
    expect(l.estRewardUsd).toBe(0);
  });

  it('early exit forfeits weight; exited positions land in the exited bucket', () => {
    const ins = positionInsight(rec({ status: 'exited', forfeited: true }), arena, NOW);
    expect(ins.bucket).toBe('exited');
    expect(ins.weight).toBe(0);
  });
});

describe('arena model', () => {
  it('countdown label follows the phase', () => {
    const live = buildFixtureArena(FIXTURE_DEFS[1]!, NOW);
    expect(arenaCountdown(live, NOW).label).toBe('BACKING CLOSES IN');
    expect(isBackable(live, NOW)).toBe(true);
    const locked = buildFixtureArena(FIXTURE_DEFS[0]!, NOW);
    expect(locked.status).toBe('backing_closed');
    expect(arenaCountdown(locked, NOW)).toEqual({ label: 'ENDS IN', secs: locked.endTs - NOW });
    expect(isBackable(locked, NOW)).toBe(false);
    const settled = buildFixtureArena(
      FIXTURE_DEFS.find((d) => d.kind === 'settled')!,
      NOW,
    );
    expect(arenaCountdown(settled, NOW)).toEqual({ label: 'SETTLED', secs: 0 });
    const cancelled = buildFixtureArena(
      FIXTURE_DEFS.find((d) => d.kind === 'cancelled')!,
      NOW,
    );
    expect(arenaCountdown(cancelled, NOW).label).toBe('CANCELLED');
  });
});

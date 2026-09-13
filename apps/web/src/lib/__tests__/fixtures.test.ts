import { describe, expect, it } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena, listFixtureArenas } from '../arena/fixtures';
import { arenaCountdown, isBackable } from '../arena/model';

const NOW = 1_789_300_000; // the fixture anchor

describe('fixture engine', () => {
  it('is deterministic for a given clock', () => {
    const a = listFixtureArenas(NOW);
    const b = listFixtureArenas(NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes with the clock but keeps identity', () => {
    const a = buildFixtureArena(FIXTURE_DEFS[0]!, NOW);
    const b = buildFixtureArena(FIXTURE_DEFS[0]!, NOW + 600);
    expect(a.slug).toBe(b.slug);
    expect(a.startTs).toBe(b.startTs);
    expect(a.history.length).toBeGreaterThan(50);
    expect(b.totalBackingUsd).toBeGreaterThanOrEqual(a.totalBackingUsd);
  });

  it('featured BONK vs TSLAx is running at the anchor with 1:42:18 left and BONK leading', () => {
    const a = buildFixtureArena(FIXTURE_DEFS[0]!, NOW);
    expect(a.slug).toBe('bonk-vs-tslax');
    expect(a.status).toBe('backing_closed'); // inside the hold window (last 10 %)
    expect(a.endTs - NOW).toBe(1 * 3600 + 42 * 60 + 18);
    expect(a.leader).toBe('a');
    expect(a.sides[0].perfPct).toBeGreaterThan(a.sides[1].perfPct);
    expect(a.sides[0].backingShare).toBeCloseTo(0.73, 2);
    expect(a.sides[0].backingUsd + a.sides[1].backingUsd).toBe(a.totalBackingUsd);
  });

  it('every side starts at 0.00 % and history is monotonic in time', () => {
    for (const a of listFixtureArenas(NOW)) {
      if (a.history.length === 0) continue;
      expect(a.history[0]).toMatchObject({ a: 0, b: 0 });
      for (let i = 1; i < a.history.length; i++) {
        expect(a.history[i]!.t).toBeGreaterThan(a.history[i - 1]!.t);
      }
      const last = a.history[a.history.length - 1]!;
      expect(last.a).toBe(a.sides[0].perfPct);
      expect(last.b).toBe(a.sides[1].perfPct);
    }
  });

  it('exposes every lifecycle state for demos', () => {
    const states = new Set(listFixtureArenas(NOW).map((a) => a.status));
    expect(states.has('scheduled')).toBe(true);
    expect(states.has('settled')).toBe(true);
    expect(states.has('cancelled')).toBe(true);
    expect(states.has('live')).toBe(true);
  });

  it('scheduled Arenas are always in the future and never backable', () => {
    const later = NOW + 30 * 86_400;
    const def = FIXTURE_DEFS.find((d) => d.kind === 'scheduled')!;
    const s = buildFixtureArena(def, later);
    expect(s.status).toBe('scheduled');
    expect(s.startTs).toBeGreaterThan(later);
    expect(isBackable(s, later)).toBe(false);
    expect(arenaCountdown(s, later).label).toBe('OPENS IN');
  });

  it('underdog multiplier is above 1 on the smaller side and 1 on the favourite', () => {
    const a = listFixtureArenas(NOW).find(
      (x) => x.status === 'live' && x.sides[0].backingShare > 0.6,
    )!;
    expect(a.sides[1].multiplier).toBeGreaterThan(1);
    expect(a.sides[0].multiplier).toBe(1);
  });

  it('activity only contains events up to now, newest first', () => {
    const a = buildFixtureArena(FIXTURE_DEFS[0]!, NOW);
    expect(a.activity.length).toBeGreaterThan(5);
    for (const it of a.activity) expect(it.ts).toBeLessThanOrEqual(NOW);
    for (let i = 1; i < a.activity.length; i++) {
      expect(a.activity[i]!.ts).toBeLessThanOrEqual(a.activity[i - 1]!.ts);
    }
  });
});

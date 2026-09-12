import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_PARAMS } from '../config/policy';
import {
  BONK,
  DAY,
  HOUR,
  SOL,
  TSLA_PRICE_Q8,
  arenaConfig,
  harness,
  unitsForUsd,
  type Harness,
} from '../testing/fixtures';
import { finalWinningWeights } from './arena';
import { ErrorCode, TribeError } from './errors';
import { ONE_Q4, rampMultiplierQ4, rawMultiplierQ4, warmupSecs } from './underdog';

const P = DEFAULT_ARENA_PARAMS.underdog;

function mult(r: ReturnType<Harness['back']>): bigint {
  const e = r.effects[0];
  if (e?.kind !== 'Backed') throw new Error('not a Backed effect');
  return e.multiplierQ4;
}

describe('rawMultiplierQ4', () => {
  it('matches the documented table', () => {
    expect(rawMultiplierQ4(2000n, P)).toBe(16_000n);
    expect(rawMultiplierQ4(4000n, P)).toBe(12_000n);
    expect(rawMultiplierQ4(4500n, P)).toBe(11_000n);
    expect(rawMultiplierQ4(5000n, P)).toBe(10_000n);
    expect(rawMultiplierQ4(8000n, P)).toBe(10_000n); // majority never < 1.0×
    expect(rawMultiplierQ4(0n, P)).toBe(20_000n); // cap
    expect(rawMultiplierQ4(0n, { ...P, capQ4: 15_000 })).toBe(15_000n);
  });
});

describe('warm-up', () => {
  it('uses max(10 % of duration, 30 min)', () => {
    expect(warmupSecs(DAY, P)).toBe(8640n);
    expect(warmupSecs(HOUR, P)).toBe(1800n);
    expect(warmupSecs(30n * DAY, P)).toBe(3n * DAY);
  });
  it('ramps linearly and saturates', () => {
    expect(rampMultiplierQ4(16_000n, 0n, 8640n)).toBe(10_000n);
    expect(rampMultiplierQ4(16_000n, 4320n, 8640n)).toBe(13_000n);
    expect(rampMultiplierQ4(16_000n, 8640n, 8640n)).toBe(16_000n);
    expect(rampMultiplierQ4(16_000n, 100n * DAY, 8640n)).toBe(16_000n);
    expect(rampMultiplierQ4(16_000n, 5n, 0n)).toBe(16_000n);
    expect(() => rampMultiplierQ4(16_000n, -1n, 8640n)).toThrow(TribeError);
  });
});

/** Standard 24 h BONK vs TSLAx Arena with honest backing X on each side at t0. */
function balanced(xUsd = 10_000n, opts: Parameters<typeof arenaConfig>[0] = {}): Harness {
  const h = harness(arenaConfig(opts));
  h.start();
  const t0 = h.state.config.startTs;
  h.back('honestA', 'A', unitsForUsd(h.state, 'A', xUsd), t0);
  h.back('honestB', 'B', unitsForUsd(h.state, 'B', xUsd), t0);
  return h;
}

describe('adversarial underdog simulations', () => {
  const warm = 8640n; // 10 % of 24 h

  it('S1 attacker backs the opponent to manufacture underdog status, right at start', () => {
    const h = balanced();
    const t0 = h.state.config.startTs;
    // attacker piles 4X onto A, then backs B (now 1/6 share) one minute later
    h.back('attacker', 'A', unitsForUsd(h.state, 'A', 40_000n), t0 + 30n);
    const m = mult(h.back('attacker', 'B', unitsForUsd(h.state, 'B', 10_000n), t0 + 60n));
    // raw would be ~1.6×; warm-up ramp at 60 s / 8640 s ⇒ ≈ 1.004×
    expect(m).toBeLessThanOrEqual(10_050n);
  });

  it('S2 attacker deposits on opponent then withdraws immediately, mid-Arena', () => {
    const h = balanced();
    const t0 = h.state.config.startTs;
    const t = t0 + 6n * HOUR;
    h.back('attacker', 'A', unitsForUsd(h.state, 'A', 40_000n), t);
    const m = mult(h.back('attacker', 'B', unitsForUsd(h.state, 'B', 10_000n), t + 1n));
    // instant share of B after deposit: 20k / 70k = 28.6 % → raw 1.43×;
    // TWAB share of B over 6 h ≈ 50 % (4999 bps after flooring) → share_eff = max → ≈ 1.000×
    expect(m).toBeLessThanOrEqual(10_010n);
    h.exit('attacker', 'A', h.state.positions['A:attacker']?.units ?? 0n, t + 2n);
    expect(h.state.positions['A:attacker']?.effUnitSeconds).toBe(0n); // and the A leg is forfeited
  });

  it('S3 attacker holds the opponent side long enough to drag the TWAB', () => {
    const h = balanced();
    const t0 = h.state.config.startTs;
    // 4X on A from t0+1 (so first-block ordering is deterministic)
    h.back('attacker', 'A', unitsForUsd(h.state, 'A', 40_000n), t0 + 1n);
    // At +18 h the TWAB share of B ≈ 1/6 (raw 1.67×) but the *instant* share after
    // the attacker's own B deposit is 20k/70k ≈ 28.6 % → max ⇒ 1.43×. Only 6 h remain.
    const t = t0 + 18n * HOUR;
    const r = h.back('attacker', 'B', unitsForUsd(h.state, 'B', 10_000n), t);
    const m = mult(r);
    expect(m).toBeGreaterThan(14_000n);
    expect(m).toBeLessThanOrEqual(14_300n);
    // weight of the manipulated tranche vs honestB (same capital, held 24 h)
    h.settle({ A: 281n, B: TSLA_PRICE_Q8 + 1_000_000_000n });
    const atk = h.state.positions['B:attacker'];
    const hon = h.state.positions['B:honestB'];
    if (!atk || !hon) throw new Error('missing');
    // attacker: 10k × 1.6 × 6 h  vs honest: 10k × 1.0 × 24 h  → attacker < half of honest
    const c = h.state.config;
    const wAtk = atk.effUnitSeconds + atk.effUnits * (c.endTs - atk.lastTouchTs);
    const wHon = hon.effUnitSeconds + hon.effUnits * (c.endTs - hon.lastTouchTs);
    expect(wAtk * 2n).toBeLessThan(wHon);
    // and the attacker held $40k of A (the losing side) for 24 h to get there
  });

  it('S4 splitting capital across wallets yields identical total weight (no gain, no loss)', () => {
    const one = balanced();
    const split = balanced();
    const t = one.state.config.startTs + 3n * HOUR;
    one.back('w', 'B', unitsForUsd(one.state, 'B', 4000n), t);
    for (let i = 0; i < 4; i++) {
      split.back(`w${i}`, 'B', unitsForUsd(split.state, 'B', 1000n), t + BigInt(i));
    }
    // Later deposits in the split case see a slightly higher B share → equal or lower multiplier.
    const mOne = one.state.positions['B:w']?.effUnits ?? 0n;
    let mSplit = 0n;
    for (let i = 0; i < 4; i++) mSplit += split.state.positions[`B:w${i}`]?.effUnits ?? 0n;
    expect(mSplit).toBeLessThanOrEqual(mOne);
    expect(mOne - mSplit).toBeLessThan(mOne / 100n); // within 1 %
  });

  it('S5 attacker on both sides: the boosted tranche is bounded by cap and its own share', () => {
    const h = balanced(1000n);
    const t = h.state.config.startTs + 12n * HOUR;
    const r = h.back('attacker', 'B', unitsForUsd(h.state, 'B', 100_000n), t);
    // post-deposit B share = 101k/102k ≈ 99 % → 1.0×: a whale cannot boost itself
    expect(mult(r)).toBe(ONE_Q4);
    const r2 = h.back('attacker', 'A', unitsForUsd(h.state, 'A', 1000n), t + 1n);
    // A share instant ≈ 2 % → raw 1.96×; TWAB of A over 12 h ≈ 50 % → ≈ 1.00×
    expect(mult(r2)).toBeLessThanOrEqual(10_020n);
  });

  it('S6 whale immediately before the cutoff is rejected outright', () => {
    const h = balanced();
    const close = h.state.backingCloseTs;
    expect(() => h.back('whale', 'B', unitsForUsd(h.state, 'B', 1_000_000n), close)).toThrow(
      TribeError,
    );
    try {
      h.back('whale', 'B', unitsForUsd(h.state, 'B', 1_000_000n), close + 1n);
    } catch (e) {
      expect((e as TribeError).code).toBe(ErrorCode.BackingClosed);
    }
    // one second earlier it is accepted but has only min_hold of accrual left
    const r = h.back('whale', 'B', unitsForUsd(h.state, 'B', 1_000_000n), close - 1n);
    expect(mult(r)).toBe(ONE_Q4); // 99 % share → no boost
  });

  it('S7 repeated small deposits cannot ratchet the multiplier', () => {
    const h = balanced();
    const t0 = h.state.config.startTs;
    let last = 0n;
    for (let i = 0; i < 20; i++) {
      const m = mult(
        h.back('dripper', 'B', unitsForUsd(h.state, 'B', 100n), t0 + 20n * HOUR + BigInt(i)),
      );
      // B share only grows with each drip → multiplier non-increasing
      if (i > 0) expect(m).toBeLessThanOrEqual(last);
      last = m;
      expect(m).toBe(ONE_Q4); // balanced Arena → B is never the underdog
    }
  });

  it('S8 sudden imbalance: a genuine late underdog gets a boost, but only after warm-up', () => {
    const h = harness();
    h.start();
    const t0 = h.state.config.startTs;
    h.back('crowdA', 'A', unitsForUsd(h.state, 'A', 80_000n), t0);
    // a lone B backer during warm-up
    const early = mult(h.back('b1', 'B', unitsForUsd(h.state, 'B', 20_000n), t0 + 864n)); // 10 % of warm-up
    // instant 20 % → raw 1.6×, ramp 0.1 → ≈ 1.06×
    expect(early).toBeGreaterThanOrEqual(10_590n);
    expect(early).toBeLessThanOrEqual(10_610n);
    // after warm-up, TWAB and instant agree on ≈ 20 % → full ≈ 1.6×
    const later = mult(h.back('b2', 'B', unitsForUsd(h.state, 'B', 10n), t0 + 3n * HOUR));
    expect(later).toBeGreaterThanOrEqual(15_900n);
    expect(later).toBeLessThanOrEqual(16_010n);
  });

  it('S9 one-sided Arena: the only side is never an underdog, first backer is 1.0×', () => {
    const h = harness();
    h.start();
    const t0 = h.state.config.startTs;
    expect(mult(h.back('a1', 'A', unitsForUsd(h.state, 'A', 100n), t0))).toBe(ONE_Q4);
    expect(mult(h.back('a2', 'A', unitsForUsd(h.state, 'A', 100n), t0 + 5n * HOUR))).toBe(ONE_Q4);
  });

  it('S10 zero-backing TWAB initialisation: instant share alone is used', () => {
    const h = harness();
    h.start();
    const t0 = h.state.config.startTs;
    // Two backers in the same block: no time accrued, TWAB undefined
    h.back('a1', 'A', unitsForUsd(h.state, 'A', 900n), t0);
    const m = mult(h.back('b1', 'B', unitsForUsd(h.state, 'B', 100n), t0));
    expect(m).toBe(ONE_Q4); // elapsed 0 → ramp 0
  });

  it('S11 very short Arena (1 h): warm-up floor (30 min) dominates', () => {
    const h = harness(arenaConfig({ durationSecs: HOUR }));
    h.start();
    const t0 = h.state.config.startTs;
    h.back('a', 'A', unitsForUsd(h.state, 'A', 8000n), t0);
    // backing closes at end − max(6 min, 15 min) = 45 min; warm-up = 30 min
    const m = mult(h.back('b', 'B', unitsForUsd(h.state, 'B', 2000n), t0 + 15n * 60n));
    expect(m).toBeGreaterThanOrEqual(12_990n); // half the ramp of ≈ 1.6×
    expect(m).toBeLessThanOrEqual(13_010n);
    expect(h.state.backingCloseTs).toBe(t0 + 45n * 60n);
  });

  it('S12 very long Arena (30 d): warm-up is 3 d and TWAB is hard to move', () => {
    const h = balanced(10_000n, { durationSecs: 30n * DAY });
    const t0 = h.state.config.startTs;
    h.back('attacker', 'A', unitsForUsd(h.state, 'A', 100_000n), t0 + 10n * DAY);
    // one day later: instant share of B after its own deposit = 20k/120k ≈ 16.7 % (raw 1.67×);
    // TWAB share of B = 110 / (110 + 210) ≈ 34.4 % → raw ≈ 1.31×. max ⇒ 1.31×.
    // The attacker paid fees on $100k (10× the honest side) and held the losing side a full
    // day to get +31 % weight on $10k for the remaining 19 days. Documented in SECURITY §3.
    const m = mult(h.back('attacker', 'B', unitsForUsd(h.state, 'B', 10_000n), t0 + 11n * DAY));
    expect(m).toBeGreaterThan(13_000n);
    expect(m).toBeLessThanOrEqual(13_200n);
  });

  it('S12b the optional settlement clamp neutralises the S12 attack', () => {
    const run = (clamp: boolean) => {
      const h = balanced(10_000n, { durationSecs: 30n * DAY, underdogSettlementClamp: clamp });
      const t0 = h.state.config.startTs;
      h.back('attacker', 'A', unitsForUsd(h.state, 'A', 100_000n), t0 + 10n * DAY);
      h.back('attacker', 'B', unitsForUsd(h.state, 'B', 10_000n), t0 + 11n * DAY);
      h.exit('attacker', 'A', h.state.positions['A:attacker']?.units ?? 0n, t0 + 11n * DAY + 1n);
      h.settle({ A: 281n, B: TSLA_PRICE_Q8 + 1_000_000_000n }); // B wins
      return h;
    };
    const plain = run(false);
    const clamped = run(true);
    const pw = finalWinningWeights(plain.state);
    const cw = finalWinningWeights(clamped.state);
    const get = (w: ReturnType<typeof finalWinningWeights>, k: string) =>
      w.find((x) => x.key === k)?.weight ?? 0n;
    // whole-Arena TWAB share of B ≈ (10k×30d)/(10k×30d + 10k×30d + 100k×1d) ≈ 43 % → m_settle ≈ 1.14×
    expect(clamped.state.settlement?.mUpsetQ4).toBeLessThan(11_500n);
    expect(get(cw, 'B:attacker')).toBeLessThan(get(pw, 'B:attacker'));
    // honest backer (1.0× tranche) is untouched by the clamp
    expect(get(cw, 'B:honestB')).toBe(get(pw, 'B:honestB'));
    // clamped attacker weight == unit_seconds × m_settle exactly
    const atk = clamped.state.positions['B:attacker'];
    if (!atk) throw new Error('missing');
    const c = clamped.state.config;
    const us = atk.unitSeconds + atk.units * (c.endTs - atk.lastTouchTs);
    expect(get(cw, 'B:attacker')).toBe(us * (clamped.state.settlement?.mUpsetQ4 ?? 0n));
  });

  it('S13 low-liquidity Arena (tiny backing): multipliers still bounded and deterministic', () => {
    const h = harness(arenaConfig({ assets: { A: BONK, B: SOL } }));
    h.apply({
      type: 'snapshotStart',
      now: h.state.config.startTs,
      prices: {
        A: {
          feedId: BONK.feedId,
          price: 281n,
          expo: -8,
          conf: 0n,
          publishTime: h.state.config.startTs,
          verificationLevel: 'Full',
        },
        B: {
          feedId: SOL.feedId,
          price: 10_200_000_000n,
          expo: -8,
          conf: 0n,
          publishTime: h.state.config.startTs,
          verificationLevel: 'Full',
        },
      },
    });
    const t0 = h.state.config.startTs;
    h.back('a', 'A', unitsForUsd(h.state, 'A', 6n), t0);
    const m = mult(h.back('b', 'B', unitsForUsd(h.state, 'B', 6n), t0 + 4n * HOUR));
    expect(m).toBeGreaterThanOrEqual(ONE_Q4);
    expect(m).toBeLessThanOrEqual(BigInt(P.capQ4));
  });

  it('multiplier is always within [1.0, cap] regardless of inputs', () => {
    const h = balanced(1n * 100n);
    const t0 = h.state.config.startTs;
    for (let i = 1; i <= 40; i++) {
      const side = i % 3 === 0 ? 'A' : 'B';
      const usd = BigInt(5 + ((i * 7919) % 5000));
      const m = mult(
        h.back(`u${i}`, side, unitsForUsd(h.state, side, usd), t0 + BigInt(i) * 30n * 60n),
      );
      expect(m).toBeGreaterThanOrEqual(ONE_Q4);
      expect(m).toBeLessThanOrEqual(BigInt(P.capQ4));
    }
    expect(warm).toBe(8640n);
  });
});

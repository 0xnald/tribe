import { describe, expect, it } from 'vitest';

import { MULT_Q6, Q10 } from '../constants';
import {
  MathError,
  assertU256,
  decideWinner,
  notionalUsdc,
  perfBps,
  refPriceQ10,
  toQ10,
} from './fixed';

/** $365.25 and $100 in Q10. */
const TSLA = 3_652_500_000_000n;
const S = 1_000_000_000_000n;

describe('toQ10', () => {
  it('keeps expo −10 as-is and scales expo −8 (Pyth) up by 100', () => {
    expect(toQ10(TSLA, -10)).toBe(TSLA);
    expect(toQ10(36_525_000_000n, -8)).toBe(TSLA);
  });
  it('scales other exponents', () => {
    expect(toQ10(365_25n, -2)).toBe(TSLA);
    expect(toQ10(2_816_164_455n, -15)).toBe(28_161n); // BONK ≈ $0.0000028161
  });
  it('rejects non-positive and absurd inputs', () => {
    expect(() => toQ10(0n, -8)).toThrow(MathError);
    expect(() => toQ10(1n, -20)).toThrow(MathError);
    expect(() => toQ10(1n, -18)).toThrow(MathError); // underflows to 0
    expect(() => toQ10(1n << 62n, 8)).toThrow(MathError); // exceeds u64
  });
});

describe('refPriceQ10', () => {
  it('is identity at multiplier 1.0', () => {
    expect(refPriceQ10(TSLA)).toBe(TSLA);
  });
  it('applies a 4:1 split multiplier price-continuously', () => {
    // TSLA $365.25 pre-split; post-split $91.3125 with multiplier 4.0 → same raw-unit value
    const post = toQ10(9_131_250_000n, -8);
    expect(refPriceQ10(post, 4n * MULT_Q6)).toBe(TSLA);
  });
  it('applies a reinvested dividend (1.008)', () => {
    expect(refPriceQ10(S, 1_008_000n)).toBe(1_008_000_000_000n);
  });
});

describe('notionalUsdc', () => {
  it('values 0.27337718 TSLAx (8 dp) at $365.25 ≈ 99.85 USDC', () => {
    expect(notionalUsdc(27_337_718n, TSLA, 8)).toBe(99_851_014n);
  });
  it('values 35,000,000 BONK (5 dp) at $0.00000281 ≈ 98.35 USDC', () => {
    expect(notionalUsdc(35_000_000_00000n, 28_100n, 5)).toBe(98_350_000n);
  });
  it('floors dust', () => {
    expect(notionalUsdc(1n, 1n, 8)).toBe(0n);
  });
  it('matches the Q8 result exactly for the same USD price (only precision changed)', () => {
    // Q8: units × 281 / 10^7 ; Q10: units × 28 100 / 10^9 — identical rationals
    const units = 62_277_580_071_173n;
    expect(notionalUsdc(units, 28_100n, 5)).toBe((units * 281n) / 10_000_000n);
  });
});

describe('perfBps', () => {
  it('computes signed basis points', () => {
    expect(perfBps(S, 1_084_200_000_000n)).toBe(842n);
    expect(perfBps(S, 978_300_000_000n)).toBe(-217n);
  });
  it('floors toward −∞ for negatives (matches i128 div_euclid)', () => {
    expect(perfBps(S, 999_990_000_000n)).toBe(-1n);
    expect(perfBps(S, 1_000_010_000_000n)).toBe(0n);
  });
});

describe('decideWinner', () => {
  it('picks the greater percentage move', () => {
    expect(decideWinner(S, 1_084_200_000_000n, S, 1_021_700_000_000n, 1n)).toBe('A');
    expect(decideWinner(S, 950_000_000_000n, S, 910_000_000_000n, 1n)).toBe('A'); // both down, A fell less
    expect(decideWinner(28_100n, 30_000n, S, 1_050_000_000_000n, 1n)).toBe('A'); // +6.76% vs +5%
  });
  it('works across very different price scales', () => {
    expect(decideWinner(28_100n, 28_100n, S, 1_000_200_000_000n, 1n)).toBe('B');
    expect(decideWinner(28_100n, 28_100n, S, 1_000_100_000_000n, 1n)).toBe('TIE'); // exactly on the band
  });
  it('declares TIE inside the band and not outside it', () => {
    expect(decideWinner(S, 1_000_050_000_000n, S, S, 1n)).toBe('TIE'); // +0.5 bps
    expect(decideWinner(S, 1_000_200_000_000n, S, S, 1n)).toBe('A'); // +2 bps
    expect(decideWinner(S, S + 1n, S, S, 0n)).toBe('A'); // zero band: any difference decides
  });
  it('rejects zero prices', () => {
    expect(() => decideWinner(0n, S, S, S, 1n)).toThrow(MathError);
  });
});

/**
 * BONK precision — the reason for Q10. At Q8 BONK ≈ $0.00000271 was the
 * integer 271, so one step was 0.37 % and the 1 bps tie band could never
 * trigger. At Q10 the same price is 27 100 and one step is 0.37 bps.
 */
describe('BONK precision at Q10', () => {
  const p250 = toQ10(2_500n, -9); // $0.00000250
  const p271 = toQ10(2_710n, -9); // $0.00000271
  const p300 = toQ10(3_000n, -9); // $0.00000300
  it('represents realistic BONK prices with bps resolution', () => {
    expect(p250).toBe(25_000n);
    expect(p271).toBe(27_100n);
    expect(p300).toBe(30_000n);
    // a Pyth update at expo −8 (271e-8) lands on the same integer
    expect(toQ10(271n, -8)).toBe(p271);
    // relative step size at $0.00000271 is 1 / 27 100 ≈ 0.37 bps (was 37 bps at Q8)
    expect((10_000n * 10_000n) / p271).toBe(3_690n); // 0.369 bps × 10 000
  });
  it('distinguishes moves far below the old 0.37 % Q8 step', () => {
    // +0.05 % on BONK: 27 100 → 27 114 (Q8 would have rounded 271.14 back to 271 → "flat")
    const up5bps = (p271 * 10_005n) / 10_000n;
    expect(up5bps).toBe(27_113n);
    expect(perfBps(p271, up5bps)).toBe(4n); // 4.8 bps, floored
    expect(perfBps(p271, p271 + 1n)).toBe(0n); // one tick = 0.37 bps
    expect(perfBps(p271, p271 + 3n)).toBe(1n); // three ticks = 1.1 bps
    expect(decideWinner(p271, up5bps, S, S, 1n)).toBe('A'); // +4.8 bps beats flat with a 1 bps band
    expect(decideWinner(p271, p271 + 1n, S, S, 1n)).toBe('TIE'); // +0.37 bps is inside the band
    expect(decideWinner(p271, p271 + 3n, S, S, 1n)).toBe('A'); // +1.1 bps is outside it
  });
  it('is deterministic and equals the exact rational comparison', () => {
    // A: 2.50 → 2.71 (+8.4 %) vs B: 2.71 → 3.00 (+10.7 %): B wins; and again when both are BONK-scale
    expect(decideWinner(p250, p271, p271, p300, 1n)).toBe('B');
    expect(decideWinner(p271, p300, p250, p271, 1n)).toBe('A');
    // exact rational: (p300/p271) vs (p271/p250) → 1.1070 vs 1.0840
    const lhs = p300 * p250; // endA×startB
    const rhs = p271 * p271; // endB×startA
    expect(lhs > rhs).toBe(true);
    for (let i = 0; i < 5; i++) expect(decideWinner(p271, p300, p250, p271, 1n)).toBe('A');
  });
  it('keeps notional and fee arithmetic exact for BONK-sized positions', () => {
    // 10 000 000 BONK (5 dp) at $0.00000271 = $27.10
    expect(notionalUsdc(10_000_000_00000n, p271, 5)).toBe(27_100_000n);
    // 1 BONK unit (0.00001 BONK) floors to 0 micro-USDC — dust never rounds up
    expect(notionalUsdc(1n, p271, 5)).toBe(0n);
  });
});

/**
 * High-price headroom — executable, not a claim. u64 caps the reference
 * price at ≈ $1.84e9; the winner rule and tie band use 256-bit
 * intermediates so every u64 price is safe; notional stays in u128.
 */
describe('Q10 headroom', () => {
  const U64_MAX = (1n << 64n) - 1n;
  const prices = [
    ['BTC $120 000', 1_200_000_000_000_000n],
    ['$1 000 000', 10_000_000_000_000_000n],
    ['$100 000 000', 1_000_000_000_000_000_000n],
    ['u64 max ≈ $1.84e9', U64_MAX],
  ] as const;
  it('normalises up to the u64 bound and rejects beyond it', () => {
    expect(toQ10(120_000_00000000n, -8)).toBe(1_200_000_000_000_000n); // $120 000
    expect(toQ10(1_000_000_000n, 0)).toBe(1_000_000_000n * Q10); // $1e9 fits
    expect(() => toQ10(2_000_000_000n, 0)).toThrow(MathError); // $2e9 does not
  });
  for (const [label, p] of prices) {
    it(`winner rule and tie band at ${label}`, () => {
      // cross products ≤ u64² < 2^128; band = tieBps × p² ≤ 10 000 × 2^128 < 2^256
      expect(decideWinner(p, p, p, p, 10_000n)).toBe('TIE');
      expect(decideWinner(p, p, p - 1n, p, 0n)).toBe('B');
      expect(decideWinner(p - 1n, p, p, p, 0n)).toBe('A');
      expect(assertU256(10_000n * p * p)).toBe(10_000n * p * p);
    });
    it(`notional at ${label} with max units stays in u128`, () => {
      const n = notionalUsdc(U64_MAX, p, 0);
      expect(n).toBeLessThan(1n << 128n);
      expect(n).toBe((U64_MAX * p) / 10_000n);
    });
    it(`perfBps at ${label}`, () => {
      expect(perfBps(p, p)).toBe(0n);
      expect(perfBps(p, (p / 100n) * 101n)).toBeGreaterThanOrEqual(99n);
    });
  }
  it('refPriceQ10 with the maximum ScaledUi multiplier stays in u64 up to $18.4M', () => {
    // multiplier ≤ 100× (Q6 = 1e8): price × 1e8 / 1e6 = price × 100 must fit u64
    const p = 184_467_440_000_000_000n; // $18.4M
    expect(refPriceQ10(p, 100n * MULT_Q6)).toBe(p * 100n);
    expect(() => refPriceQ10(p * 2n, 100n * MULT_Q6)).toThrow(MathError);
  });
});

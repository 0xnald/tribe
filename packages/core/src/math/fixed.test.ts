import { describe, expect, it } from 'vitest';

import { MULT_Q6 } from '../constants';
import { MathError, decideWinner, notionalUsdc, perfBps, refPriceQ8, toQ8 } from './fixed';

describe('toQ8', () => {
  it('keeps expo −8 as-is', () => {
    expect(toQ8(36_525_000_000n, -8)).toBe(36_525_000_000n); // $365.25
  });
  it('scales other exponents', () => {
    expect(toQ8(365_25n, -2)).toBe(36_525_000_000n);
    expect(toQ8(2_816_164_455n, -15)).toBe(281n); // BONK ≈ $0.00000281
  });
  it('rejects non-positive and absurd inputs', () => {
    expect(() => toQ8(0n, -8)).toThrow(MathError);
    expect(() => toQ8(1n, -20)).toThrow(MathError);
    expect(() => toQ8(1n, -18)).toThrow(MathError); // underflows to 0
  });
});

describe('refPriceQ8', () => {
  it('is identity at multiplier 1.0', () => {
    expect(refPriceQ8(36_525_000_000n)).toBe(36_525_000_000n);
  });
  it('applies a 4:1 split multiplier price-continuously', () => {
    // TSLA $365.25 pre-split; post-split $91.3125 with multiplier 4.0 → same raw-unit value
    const post = toQ8(9_131_250_000n, -8);
    expect(refPriceQ8(post, 4n * MULT_Q6)).toBe(36_525_000_000n);
  });
  it('applies a reinvested dividend (1.008)', () => {
    expect(refPriceQ8(100_00000000n, 1_008_000n)).toBe(100_80000000n);
  });
});

describe('notionalUsdc', () => {
  it('values 0.27337718 TSLAx (8 dp) at $365.25 ≈ 99.85 USDC', () => {
    expect(notionalUsdc(27_337_718n, 36_525_000_000n, 8)).toBe(99_851_014n);
  });
  it('values 35,000,000 BONK (5 dp) at $0.00000281 ≈ 98.35 USDC', () => {
    expect(notionalUsdc(35_000_000_00000n, 281n, 5)).toBe(98_350_000n);
  });
  it('floors dust', () => {
    expect(notionalUsdc(1n, 1n, 8)).toBe(0n);
  });
});

describe('perfBps', () => {
  it('computes signed basis points', () => {
    expect(perfBps(100_00000000n, 108_42000000n)).toBe(842n);
    expect(perfBps(100_00000000n, 97_83000000n)).toBe(-217n);
  });
  it('floors toward −∞ for negatives (matches i128 div_euclid)', () => {
    // (99.999 − 100) / 100 = −0.001% = −0.1 bps → floor → −1 bps
    expect(perfBps(100_00000000n, 99_99900000n)).toBe(-1n);
    expect(perfBps(100_00000000n, 100_00100000n)).toBe(0n);
  });
});

describe('decideWinner', () => {
  const s = 100_00000000n;
  it('picks the greater percentage move', () => {
    expect(decideWinner(s, 108_42000000n, s, 102_17000000n, 1n)).toBe('A');
    expect(decideWinner(s, 95_00000000n, s, 91_00000000n, 1n)).toBe('A'); // both down, A fell less
    expect(decideWinner(281n, 300n, s, 105_00000000n, 1n)).toBe('A'); // +6.76% vs +5%
  });
  it('works across very different price scales', () => {
    expect(decideWinner(281n, 281n, s, 100_02000000n, 1n)).toBe('B');
    expect(decideWinner(281n, 281n, s, 100_01000000n, 1n)).toBe('TIE'); // exactly on the 1 bps band
  });
  it('declares TIE inside the band and not outside it', () => {
    // A: +0.005% (0.5 bps) vs B: flat → within 1 bps → TIE
    expect(decideWinner(s, 100_00500000n, s, s, 1n)).toBe('TIE');
    // A: +0.02% (2 bps) vs B: flat → beyond 1 bps → A
    expect(decideWinner(s, 100_02000000n, s, s, 1n)).toBe('A');
    // zero band: any difference decides
    expect(decideWinner(s, s + 1n, s, s, 0n)).toBe('A');
  });
  it('rejects zero prices', () => {
    expect(() => decideWinner(0n, s, s, s, 1n)).toThrow(MathError);
  });
});

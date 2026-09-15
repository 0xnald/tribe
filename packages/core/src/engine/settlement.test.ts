import { describe, expect, it } from 'vitest';

import { BONK, TSLA_PRICE_Q10, TSLAX, priceInput, BONK_PRICE_Q10 } from '../testing/fixtures';
import { ErrorCode } from './errors';
import { validatePriceUpdate } from './oracle';
import { resolveSettlement, settleFromPrices } from './settlement';
import type { SidePriceSnapshot } from './types';

const T = 1_760_000_000n;
const S = 1_000_000_000_000n; // $100 in Q10

describe('validatePriceUpdate', () => {
  it('accepts an exact-window update and normalises exponents', () => {
    const r = validatePriceUpdate(
      priceInput(BONK, 281_000n, T + 59n, { expo: -11 }),
      BONK,
      T,
      false,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.priceQ10).toBe(BONK_PRICE_Q10);
      expect(r.snapshot.mode).toBe('Exact');
    }
  });
  it('rejects feed mismatch, partial verification, zero/negative price, wide confidence', () => {
    const bad = (extra: Parameters<typeof priceInput>[3]) =>
      validatePriceUpdate(priceInput(BONK, BONK_PRICE_Q10, T, extra), BONK, T, false);
    expect(bad({ feedId: TSLAX.feedId })).toMatchObject({
      ok: false,
      code: ErrorCode.OracleFeedMismatch,
    });
    expect(bad({ verificationLevel: 'Partial' })).toMatchObject({
      ok: false,
      code: ErrorCode.OracleNotFullyVerified,
    });
    expect(bad({ price: 0n })).toMatchObject({ ok: false, code: ErrorCode.OracleNonPositivePrice });
    expect(bad({ price: -BONK_PRICE_Q10 })).toMatchObject({
      ok: false,
      code: ErrorCode.OracleNonPositivePrice,
    });
    // conf 1 % of price = 100 bps → allowed; 1.01 % → rejected (crypto max 100 bps)
    expect(bad({ price: 10_000n, conf: 100n })).toMatchObject({ ok: true });
    expect(bad({ price: 10_000n, conf: 101n })).toMatchObject({
      ok: false,
      code: ErrorCode.OracleConfidenceTooWide,
    });
    expect(bad({ expo: -20 })).toMatchObject({
      ok: false,
      code: ErrorCode.OracleUnsupportedExponent,
    });
  });
  it('enforces the exact window and never accepts future prints', () => {
    expect(validatePriceUpdate(priceInput(BONK, BONK_PRICE_Q10, T + 60n), BONK, T, false).ok).toBe(
      true,
    );
    expect(
      validatePriceUpdate(priceInput(BONK, BONK_PRICE_Q10, T + 61n), BONK, T, false),
    ).toMatchObject({
      code: ErrorCode.OracleTooEarly,
    });
    expect(
      validatePriceUpdate(priceInput(BONK, BONK_PRICE_Q10, T - 61n), BONK, T, false),
    ).toMatchObject({
      code: ErrorCode.OracleStale,
    });
  });
  it('LastKnown only for non-crypto, only when allowed, only within max staleness', () => {
    const closed = priceInput(TSLAX, TSLA_PRICE_Q10, T - 50n * 3600n);
    expect(validatePriceUpdate(closed, TSLAX, T, false)).toMatchObject({
      code: ErrorCode.OracleStale,
    });
    const ok = validatePriceUpdate(closed, TSLAX, T, true);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.snapshot.mode).toBe('LastKnown');
    expect(
      validatePriceUpdate(priceInput(TSLAX, TSLA_PRICE_Q10, T - 73n * 3600n), TSLAX, T, true),
    ).toMatchObject({ code: ErrorCode.OracleStale });
    expect(
      validatePriceUpdate(priceInput(BONK, BONK_PRICE_Q10, T - 3600n), BONK, T, true),
    ).toMatchObject({
      code: ErrorCode.OracleStale,
    });
  });
  it('applies the ScaledUi multiplier only to scaled assets', () => {
    const r = validatePriceUpdate(
      priceInput(TSLAX, TSLA_PRICE_Q10, T, { multQ6: 4_032_000n }),
      TSLAX,
      T,
      false,
    );
    if (!r.ok) throw new Error(r.detail);
    expect(r.snapshot.priceQ10).toBe((TSLA_PRICE_Q10 * 4_032_000n) / 1_000_000n);
    const b = validatePriceUpdate(
      priceInput(BONK, BONK_PRICE_Q10, T, { multQ6: 4_000_000n }),
      BONK,
      T,
      false,
    );
    if (!b.ok) throw new Error(b.detail);
    expect(b.snapshot.priceQ10).toBe(BONK_PRICE_Q10);
    expect(
      validatePriceUpdate(priceInput(TSLAX, TSLA_PRICE_Q10, T, { multQ6: 0n }), TSLAX, T, false),
    ).toMatchObject({ code: ErrorCode.InvalidParams });
  });
  it('overflow boundary: price near u64 max with positive exponent is rejected', () => {
    const r = validatePriceUpdate(priceInput(BONK, 1n << 63n, T, { expo: 8 }), BONK, T, false);
    expect(r.ok).toBe(false);
  });
});

describe('settleFromPrices', () => {
  it('equal returns → TIE; ±1 bps boundary', () => {
    expect(
      settleFromPrices({ A: { startQ10: S, endQ10: S }, B: { startQ10: S, endQ10: S } }, 1n).winner,
    ).toBe('TIE');
    // A +1 bps exactly vs flat → on the band → TIE
    expect(
      settleFromPrices(
        { A: { startQ10: S, endQ10: 1_000_100_000_000n }, B: { startQ10: S, endQ10: S } },
        1n,
      ).winner,
    ).toBe('TIE');
    // A +1 bps + 1 unit → A
    expect(
      settleFromPrices(
        { A: { startQ10: S, endQ10: 1_000_100_000_001n }, B: { startQ10: S, endQ10: S } },
        1n,
      ).winner,
    ).toBe('A');
    // A −1 bps − 1 unit vs flat → B
    expect(
      settleFromPrices(
        { A: { startQ10: S, endQ10: 999_899_999_999n }, B: { startQ10: S, endQ10: S } },
        1n,
      ).winner,
    ).toBe('B');
    // both +5 % → TIE
    expect(
      settleFromPrices(
        {
          A: { startQ10: S, endQ10: 1_050_000_000_000n },
          B: { startQ10: 28_100n, endQ10: 29_500n },
        },
        1n,
      ).winner,
    ).toBe('A'); // 295/281 = +4.98 %
  });
  it('extreme price ratios and different decimals do not overflow', () => {
    const r = settleFromPrices(
      {
        A: { startQ10: 1n, endQ10: 2n },
        B: { startQ10: 10_000_000_000_000_000n, endQ10: 19_000_000_000_000_000n },
      },
      1n,
    );
    expect(r.winner).toBe('A');
    expect(r.perfBpsA).toBe(10_000n);
    expect(r.perfBpsB).toBe(9_000n);
  });
  it('split continuity: 4:1 split mid-Arena with multiplier-adjusted prices is a TIE vs flat', () => {
    // TSLAx start $365.25 × 1.0 ; end $91.3125 × 4.0 → same raw-unit value
    const startQ10 = TSLA_PRICE_Q10;
    const endQ10 = (913_125_000_000n * 4_000_000n) / 1_000_000n;
    expect(
      settleFromPrices(
        { A: { startQ10: BONK_PRICE_Q10, endQ10: BONK_PRICE_Q10 }, B: { startQ10, endQ10 } },
        1n,
      ).winner,
    ).toBe('TIE');
  });
  it('zero price rejected', () => {
    expect(() =>
      settleFromPrices({ A: { startQ10: 0n, endQ10: S }, B: { startQ10: S, endQ10: S } }, 1n),
    ).toThrow();
  });
});

describe('resolveSettlement', () => {
  const start: Record<'A' | 'B', SidePriceSnapshot> = {
    A: {
      priceQ10: BONK_PRICE_Q10,
      oraclePriceQ10: BONK_PRICE_Q10,
      publishTime: T,
      mode: 'Exact',
      multQ6: 1_000_000n,
    },
    B: {
      priceQ10: TSLA_PRICE_Q10,
      oraclePriceQ10: TSLA_PRICE_Q10,
      publishTime: T,
      mode: 'Exact',
      multQ6: 1_000_000n,
    },
  };
  const END = T + 86_400n;
  it('reports INVALID with side and code instead of throwing', () => {
    const r = resolveSettlement({
      assets: { A: BONK, B: TSLAX },
      startSnapshots: start,
      endInputs: {
        A: priceInput(BONK, 30_000n, END),
        B: priceInput(TSLAX, TSLA_PRICE_Q10, END - 4n * 3600n),
      },
      endTs: END,
      tieBps: 1n,
      allowClosedSettlement: false,
    });
    expect(r).toMatchObject({ outcome: 'INVALID', side: 'B', code: ErrorCode.OracleStale });
  });
  it('settles SIDE_A / SIDE_B / TIE', () => {
    const go = (a: bigint, b: bigint) =>
      resolveSettlement({
        assets: { A: BONK, B: TSLAX },
        startSnapshots: start,
        endInputs: { A: priceInput(BONK, a, END), B: priceInput(TSLAX, b, END) },
        endTs: END,
        tieBps: 1n,
        allowClosedSettlement: false,
      }).outcome;
    expect(go(30_000n, TSLA_PRICE_Q10)).toBe('SIDE_A');
    expect(go(BONK_PRICE_Q10, TSLA_PRICE_Q10 + 10n ** 11n)).toBe('SIDE_B');
    expect(go(BONK_PRICE_Q10, TSLA_PRICE_Q10)).toBe('TIE');
  });
});

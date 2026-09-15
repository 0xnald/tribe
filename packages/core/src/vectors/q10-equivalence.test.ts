import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import snapshot from '../__fixtures__/arena-economics-q8.json';

/**
 * Q8 → Q10 migration guard. `arena-economics-q8.json` holds every economic
 * output of the Arena event-stream vectors as generated at commit e0a1cf7
 * with Q8 reference prices (units, accumulators, weights, fees, pools,
 * payouts, winners, perf bps). The regenerated Q10 vectors must reproduce
 * all of it exactly — only the price fields (× 100) may differ — proving
 * that the migration changed price precision and nothing else.
 */
interface Vector {
  name: string;
  expected: Record<string, unknown>;
}

const current = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'test-vectors', 'arena.json'), 'utf8'),
) as { vectors: Vector[] };

const PRICE_KEYS = new Set([
  'startPrices',
  'endPrices',
  'priceQ8',
  'priceQ10',
  'oraclePriceQ8',
  'oraclePriceQ10',
]);

/** Remove every price snapshot / price field, at any depth (settlement effects carry them too). */
function stripPrices(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripPrices);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!PRICE_KEYS.has(k)) out[k] = stripPrices(x);
    }
    return out;
  }
  return v;
}

describe('Q10 keeps Arena economics identical to Q8', () => {
  it('covers every vector in the Q8 snapshot', () => {
    expect(current.vectors.map((v) => v.name)).toEqual(snapshot.vectors.map((v) => v.name));
  });

  for (const q8 of snapshot.vectors) {
    it(q8.name, () => {
      const q10 = current.vectors.find((v) => v.name === q8.name);
      if (!q10) throw new Error(`vector ${q8.name} disappeared`);
      expect(stripPrices(q10.expected)).toEqual(stripPrices(q8.expected));
    });
  }

  it('reference prices are exactly 100× the Q8 values', () => {
    const v = current.vectors.find((x) => x.name.includes('happy path'));
    if (!v) throw new Error('happy path vector missing');
    const sp = v.expected['startPrices'] as Record<'A' | 'B', { priceQ10: string }>;
    const ep = v.expected['endPrices'] as Record<'A' | 'B', { priceQ10: string }>;
    expect(sp.A.priceQ10).toBe('28100'); // was 281
    expect(sp.B.priceQ10).toBe('3652500000000'); // was 36525000000
    expect(ep.A.priceQ10).toBe('30000'); // was 300
    expect(ep.B.priceQ10).toBe('3731759250000'); // was 37317592500
  });
});

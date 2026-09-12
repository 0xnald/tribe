import { describe, expect, it } from 'vitest';

import {
  distribute,
  distributeConditionalCap,
  distributeHardCap,
  distributeProportional,
  distributeWaterFill,
  payoutHardCap,
  type WeightedPosition,
} from './distribution';
import type { DistributionMode } from './distribution';

const POOL = 4_000_000_000n; // 4 000 USDC
const CAP = 2500n;
const w = (key: string, weight: bigint): WeightedPosition => ({ key, weight });
const M = 1_000_000n;

/** ECONOMICS §6.5 worked example: Alice 86.4, Bob 144, Erin 432, Frank 57.6 (×1e6). */
const EXAMPLE = [
  w('alice', (864n * M) / 10n),
  w('bob', (1440n * M) / 10n),
  w('erin', (4320n * M) / 10n),
  w('frank', (576n * M) / 10n),
];
const MODES: DistributionMode[] = ['Proportional', 'HardCap', 'WaterFill', 'ConditionalCap'];

describe('invariants across all modes', () => {
  const cases: WeightedPosition[][] = [
    EXAMPLE,
    [w('solo', 1n)],
    [w('a', 1n), w('b', 1n)],
    [w('a', 1n), w('b', 1n), w('c', 1n)],
    [w('whale', 90n), w('x', 5n), w('y', 5n)],
    [w('a', 0n), w('b', 3n)],
    [],
    Array.from({ length: 50 }, (_, i) => w(`u${i}`, BigInt(i + 1))),
  ];
  for (const mode of MODES) {
    it(`${mode}: Σ payouts ≤ pool, no negatives, dust ≤ n`, () => {
      for (const c of cases) {
        const r = distribute(mode, POOL, c, CAP);
        expect(r.distributed + r.remainder).toBe(POOL);
        expect(r.distributed).toBeLessThanOrEqual(POOL);
        for (const v of r.payouts.values()) expect(v).toBeGreaterThanOrEqual(0n);
        for (const p of c) if (p.weight === 0n) expect(r.payouts.get(p.key)).toBe(0n);
        if (mode === 'Proportional' && c.some((p) => p.weight > 0n)) {
          expect(r.remainder).toBeLessThan(BigInt(c.length) + 1n); // only rounding dust
        }
      }
    });
  }
  it('rejects negative weights and pool', () => {
    expect(() => distributeHardCap(POOL, [w('a', -1n)], CAP)).toThrow();
    expect(() => distributeHardCap(-1n, [w('a', 1n)], CAP)).toThrow();
  });
});

describe('A. HardCap (Phase 0 default)', () => {
  it('reproduces ECONOMICS §6.5: 2 600 paid, 1 400 rolls over', () => {
    const r = distributeHardCap(POOL, EXAMPLE, CAP);
    expect(r.payouts.get('alice')).toBe(480_000_000n);
    expect(r.payouts.get('bob')).toBe(800_000_000n);
    expect(r.payouts.get('erin')).toBe(1_000_000_000n);
    expect(r.payouts.get('frank')).toBe(320_000_000n);
    expect(r.distributed).toBe(2_600_000_000n);
    expect(r.remainder).toBe(1_400_000_000n);
  });
  it('a lone winner takes only 25 %; two equal winners only 50 % — the rollover problem', () => {
    expect(distributeHardCap(POOL, [w('solo', 1n)], CAP).remainder).toBe(3_000_000_000n);
    expect(distributeHardCap(POOL, [w('a', 1n), w('b', 1n)], CAP).remainder).toBe(2_000_000_000n);
  });
  it('per-position O(1) formula matches the batch result', () => {
    const total = EXAMPLE.reduce((s, p) => s + p.weight, 0n);
    for (const p of EXAMPLE) {
      expect(payoutHardCap(POOL, p.weight, total, CAP)).toBe(
        distributeHardCap(POOL, EXAMPLE, CAP).payouts.get(p.key),
      );
    }
    expect(payoutHardCap(POOL, 5n, 0n, CAP)).toBe(0n);
  });
});

describe('B. WaterFill (iterative capped redistribution)', () => {
  it('redistributes Erin’s excess until every cap binds — the worked example pays out in full', () => {
    const r = distributeWaterFill(POOL, EXAMPLE, CAP);
    // pass 1: Erin (60 %) capped at 1 000; remaining 3 000 shared 3:5:2 → Bob 1 500 > cap
    // pass 2: Bob capped; remaining 2 000 shared 86.4:57.6 → Alice 1 200 > cap
    // pass 3: Alice capped; Frank gets the remaining 1 000 (= cap, not > cap)
    for (const k of ['alice', 'bob', 'erin', 'frank'])
      expect(r.payouts.get(k)).toBe(1_000_000_000n);
    expect(r.remainder).toBe(0n);
  });
  it('partial redistribution when only one cap binds', () => {
    // weights 70 / 10 / 10 / 10: whale capped at 1 000, remaining 3 000 split equally
    const r = distributeWaterFill(
      POOL,
      [w('whale', 70n), w('x', 10n), w('y', 10n), w('z', 10n)],
      CAP,
    );
    expect(r.payouts.get('whale')).toBe(1_000_000_000n);
    expect(r.payouts.get('x')).toBe(1_000_000_000n);
    expect(r.remainder).toBe(0n);
    const r2 = distributeWaterFill(
      POOL,
      [w('whale', 40n), w('x', 20n), w('y', 20n), w('z', 20n)],
      CAP,
    );
    expect(r2.payouts.get('whale')).toBe(1_000_000_000n);
    expect(r2.payouts.get('x')).toBe(1_000_000_000n);
  });
  it('cascading caps: a second pass caps Bob too', () => {
    // weights 60/30/5/5 with 25 % cap: pass 1 caps whale (60 %) and b (30 %)? b's share of remaining after whale…
    const r = distributeWaterFill(
      POOL,
      [w('whale', 60n), w('b', 30n), w('c', 5n), w('d', 5n)],
      CAP,
    );
    expect(r.payouts.get('whale')).toBe(1_000_000_000n);
    expect(r.payouts.get('b')).toBe(1_000_000_000n); // 30/40 × 3 000 = 2 250 > cap → capped in pass 2
    expect(r.payouts.get('c')).toBe(1_000_000_000n); // 5/10 × 2 000 = 1 000 = cap (not > cap)
    expect(r.payouts.get('d')).toBe(1_000_000_000n);
    expect(r.remainder).toBe(0n);
  });
  it('when everyone is capped the unavoidable remainder rolls', () => {
    const r = distributeWaterFill(POOL, [w('a', 1n), w('b', 1n)], CAP);
    expect(r.payouts.get('a')).toBe(1_000_000_000n);
    expect(r.remainder).toBe(2_000_000_000n);
  });
  it('is order-independent', () => {
    const a = distributeWaterFill(POOL, EXAMPLE, CAP);
    const b = distributeWaterFill(POOL, [...EXAMPLE].reverse(), CAP);
    for (const p of EXAMPLE) expect(a.payouts.get(p.key)).toBe(b.payouts.get(p.key));
  });
});

describe('C. ConditionalCap', () => {
  it('uncaps a lone winner, 50 % for two, 34 % for three, 25 % for ≥ 4', () => {
    expect(distributeConditionalCap(POOL, [w('solo', 1n)], CAP).payouts.get('solo')).toBe(POOL);
    const two = distributeConditionalCap(POOL, [w('a', 1n), w('b', 3n)], CAP);
    expect(two.effectiveCapBps).toBe(5000n);
    expect(two.payouts.get('b')).toBe(2_000_000_000n);
    expect(two.remainder).toBe(1_000_000_000n); // b's excess still rolls
    expect(
      distributeConditionalCap(POOL, [w('a', 1n), w('b', 1n), w('c', 1n)], CAP).effectiveCapBps,
    ).toBe(3334n);
    expect(distributeConditionalCap(POOL, EXAMPLE, CAP).effectiveCapBps).toBe(2500n);
  });
});

describe('comparison on identical inputs', () => {
  const table = [
    { name: 'worked example (4 winners, one 60 % whale)', pos: EXAMPLE },
    { name: 'lone winner', pos: [w('solo', 7n)] },
    { name: 'two equal', pos: [w('a', 1n), w('b', 1n)] },
    { name: 'whale 90 % + 2 small', pos: [w('whale', 90n), w('x', 5n), w('y', 5n)] },
    { name: 'twenty equal', pos: Array.from({ length: 20 }, (_, i) => w(`u${i}`, 1n)) },
  ];
  it('rollover by mode', () => {
    const rows = table.map(({ name, pos }) => {
      const rem = (m: DistributionMode) => distribute(m, POOL, pos, CAP).remainder / 1_000_000n;
      return {
        name,
        Proportional: rem('Proportional'),
        HardCap: rem('HardCap'),
        WaterFill: rem('WaterFill'),
        ConditionalCap: rem('ConditionalCap'),
      };
    });
    // Proportional never rolls more than dust; WaterFill only when everyone is capped.
    for (const r of rows) {
      expect(r.Proportional).toBeLessThanOrEqual(1n);
      expect(r.WaterFill).toBeLessThanOrEqual(r.HardCap);
      expect(r.ConditionalCap).toBeLessThanOrEqual(r.HardCap);
    }
    expect(rows.find((r) => r.name === 'lone winner')).toMatchObject({
      HardCap: 3000n,
      WaterFill: 3000n,
      ConditionalCap: 0n,
      Proportional: 0n,
    });
    expect(rows.find((r) => r.name === 'whale 90 % + 2 small')).toMatchObject({
      HardCap: 2600n,
      WaterFill: 1000n,
      ConditionalCap: 2266n,
    });
  });
  it('Sybil: splitting the whale into 4 wallets defeats every cap (A, B, C alike)', () => {
    const whale = [w('whale', 90n), w('x', 5n), w('y', 5n)];
    const split = [w('w1', 22n), w('w2', 22n), w('w3', 23n), w('w4', 23n), w('x', 5n), w('y', 5n)];
    for (const m of ['HardCap', 'WaterFill', 'ConditionalCap'] as const) {
      const before = distribute(m, POOL, whale, CAP).payouts.get('whale') ?? 0n;
      const after = ['w1', 'w2', 'w3', 'w4'].reduce(
        (s, k) => s + (distribute(m, POOL, split, CAP).payouts.get(k) ?? 0n),
        0n,
      );
      expect(after).toBeGreaterThan(before); // the cap only ever punishes the un-split whale
    }
    const p = distributeProportional(POOL, whale).payouts.get('whale') ?? 0n;
    const ps = ['w1', 'w2', 'w3', 'w4'].reduce(
      (s, k) => s + (distributeProportional(POOL, split).payouts.get(k) ?? 0n),
      0n,
    );
    expect(ps - p).toBeLessThanOrEqual(4n); // proportional is split-neutral up to dust
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_PARAMS, DEFAULT_FEE_POLICY } from '../config/policy';
import {
  BONK,
  DAY,
  HOUR,
  T0,
  TSLA_PRICE_Q8,
  TSLAX,
  arenaConfig,
  priceInput,
} from '../testing/fixtures';
import { accruePosition } from './accrual';
import {
  applyEvent,
  createArena,
  finalWinningWeights,
  replay,
  type ArenaEffect,
  type ArenaEvent,
} from './arena';
import { distribute, type WeightedPosition } from './distribution';
import { splitFee } from './fees';
import { isTribeError } from './errors';
import type { ArenaState, DistributionMode, SideId } from './types';
import { ONE_Q4 } from './underdog';

/**
 * Property / invariant tests. Random but *valid-ish* event streams are
 * generated; invalid events are expected to throw a TribeError and leave
 * the state untouched (we test that too).
 */

const START = T0 + HOUR;
const DURATION = DAY;
const END = START + DURATION;
const OWNERS = ['w1', 'w2', 'w3', 'w4', 'w5'] as const;

/** Units of a side worth `usd` at the fixed start prices (BONK 281e-8, TSLAx 365.25). */
function unitsOf(side: SideId, usd: bigint): bigint {
  return side === 'A'
    ? (usd * 100_000_000n * 100_000n) / 281n
    : (usd * 100_000_000n * 100_000_000n) / TSLA_PRICE_Q8;
}

interface Step {
  kind: 'back' | 'exit' | 'noop';
  owner: (typeof OWNERS)[number];
  side: SideId;
  /** deposit size in whole USD (≥ 6 so the 5 USDC minimum holds after flooring) */
  usd: bigint;
  /** exit fraction in bps of the held units */
  exitBps: bigint;
  dt: bigint; // seconds after previous step
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  kind: fc.constantFrom('back', 'back', 'back', 'exit', 'noop'),
  owner: fc.constantFrom(...OWNERS),
  side: fc.constantFrom('A', 'B'),
  usd: fc.bigInt({ min: 6n, max: 5000n }),
  exitBps: fc.bigInt({ min: 1n, max: 10_000n }),
  dt: fc.bigInt({ min: 0n, max: 4n * HOUR }),
});

function feeFor(state: ArenaState, side: SideId, units: bigint): bigint {
  const p = state.startPrices[side];
  if (!p) throw new Error('not started');
  const d = state.config.assets[side].decimals;
  const notional = (units * p.priceQ8) / 10n ** BigInt(d + 2);
  return (notional * BigInt(state.config.feePolicy.feeBps)) / 10_000n;
}

/** Turn abstract steps into concrete events, applying them and recording what was accepted. */
function runSteps(
  steps: Step[],
  opts: { mode?: DistributionMode; clamp?: boolean; endPriceA?: bigint } = {},
): { state: ArenaState; accepted: ArenaEvent[]; rejected: number; effects: ArenaEffect[] } {
  const cfg = arenaConfig({
    startTs: START,
    durationSecs: DURATION,
    distributionMode: opts.mode ?? 'HardCap',
    underdogSettlementClamp: opts.clamp ?? false,
  });
  let state = createArena(cfg, T0).state;
  const accepted: ArenaEvent[] = [];
  const effects: ArenaEffect[] = [];
  let rejected = 0;
  const push = (e: ArenaEvent) => {
    try {
      const before = state;
      const r = applyEvent(state, e);
      state = r.state;
      accepted.push(e);
      effects.push(...r.effects);
      expect(state).not.toBe(before);
    } catch (err) {
      if (!isTribeError(err)) throw err;
      rejected++;
    }
  };
  push({
    type: 'snapshotStart',
    now: START,
    prices: { A: priceInput(BONK, 281n, START), B: priceInput(TSLAX, TSLA_PRICE_Q8, START) },
  });
  let now = START;
  for (const s of steps) {
    // events may run past end_ts (exits, rejected backs) but stay inside the settlement grace
    now = now + s.dt > END + HOUR ? END + HOUR : now + s.dt;
    if (s.kind === 'noop') continue;
    if (s.kind === 'back') {
      const units = unitsOf(s.side, s.usd);
      push({
        type: 'back',
        now,
        owner: s.owner,
        side: s.side,
        units,
        feePaid: feeFor(state, s.side, units),
      });
    } else {
      const held = state.positions[`${s.side}:${s.owner}`]?.units ?? 0n;
      if (held === 0n) continue;
      const x = (held * s.exitBps) / 10_000n || 1n;
      push({ type: 'exit', now, owner: s.owner, side: s.side, units: x });
    }
  }
  push({
    type: 'settle',
    now: END + 2n * HOUR,
    reserveBalance: 10_000_000_000n,
    prices: {
      A: priceInput(BONK, opts.endPriceA ?? 300n, END),
      B: priceInput(TSLAX, TSLA_PRICE_Q8, END),
    },
  });
  expect(state.status).toBe('Settled');
  return { state, accepted, rejected, effects };
}

describe('engine invariants (property-based)', () => {
  it('replaying the accepted event stream reproduces the exact final state', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 40 }), (steps) => {
        const { state, accepted } = runSteps(steps);
        const again = replay(createArena(state.config, T0).state, accepted).state;
        expect(JSON.stringify(again, bigintReplacer)).toBe(JSON.stringify(state, bigintReplacer));
      }),
      { numRuns: 150 },
    );
  });

  it('side aggregates equal the sum of positions; no position ever exceeds its side', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 40 }), (steps) => {
        const { state } = runSteps(steps);
        for (const side of ['A', 'B'] as const) {
          let units = 0n;
          let eff = 0n;
          let effSec = 0n;
          for (const p of Object.values(state.positions)) {
            if (p.side !== side) continue;
            const f = accruePosition(p, p.lastTouchTs > END ? p.lastTouchTs : END, {
              startTs: START,
              endTs: END,
            });
            units += f.units;
            eff += f.effUnits;
            effSec += f.effUnitSeconds;
            expect(f.effUnitSeconds).toBeGreaterThanOrEqual(0n);
          }
          expect(state.sides[side].units).toBe(units);
          expect(state.sides[side].effUnits).toBe(eff);
          expect(state.sides[side].effUnitSeconds).toBe(effSec);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('no post-cutoff deposit is ever accepted; no accrual outside the window', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 40 }), (steps) => {
        const { state, accepted } = runSteps(steps);
        for (const e of accepted) {
          if (e.type === 'back') expect(e.now).toBeLessThan(state.backingCloseTs);
        }
        // Maximum possible unit-seconds: every unit held the entire window
        for (const side of ['A', 'B'] as const) {
          const maxUnitsEver = accepted
            .filter(
              (e): e is Extract<ArenaEvent, { type: 'back' }> =>
                e.type === 'back' && e.side === side,
            )
            .reduce((s, e) => s + e.units, 0n);
          expect(state.sides[side].unitSeconds).toBeLessThanOrEqual(maxUnitsEver * DURATION);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('every multiplier is within [1.0, cap]; Σ payouts ≤ pool in every mode; losers get nothing', () => {
    const modes: DistributionMode[] = ['HardCap', 'WaterFill', 'ConditionalCap', 'Proportional'];
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 30 }),
        fc.constantFrom(...modes),
        fc.boolean(),
        (steps, mode, clamp) => {
          const { state, effects } = runSteps(steps, { mode, clamp });
          for (const e of effects) {
            if (e.kind !== 'Backed') continue;
            expect(e.multiplierQ4).toBeGreaterThanOrEqual(ONE_Q4);
            expect(e.multiplierQ4).toBeLessThanOrEqual(BigInt(DEFAULT_ARENA_PARAMS.underdog.capQ4));
          }
          const st = state.settlement;
          if (!st) throw new Error('not settled');
          let s = state;
          let paid = 0n;
          for (const p of Object.values(state.positions)) {
            try {
              const r = applyEvent(s, {
                type: 'claim',
                now: END + HOUR,
                owner: p.owner,
                side: p.side,
              });
              s = r.state;
              const eff = r.effects[0];
              if (eff?.kind === 'RewardClaimed') {
                paid += eff.amount;
                expect(p.side).toBe(st.winner);
              }
            } catch (err) {
              if (!isTribeError(err)) throw err;
              if (st.winner !== 'TIE' && p.side !== st.winner)
                expect(err.code).toBe('NotWinningSide');
            }
          }
          expect(paid).toBeLessThanOrEqual(st.poolAtSettlement);
          expect(s.rewardVault).toBe(st.poolAtSettlement - paid);
          expect(s.rewardVault).toBeGreaterThanOrEqual(0n);
          // second claims all fail
          for (const p of Object.values(s.positions)) {
            if (!p.claimed) continue;
            expect(() =>
              applyEvent(s, { type: 'claim', now: END + HOUR, owner: p.owner, side: p.side }),
            ).toThrow();
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('principal is conserved: units in = units held + units withdrawn (no redistribution)', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 40 }), (steps) => {
        const { state, accepted } = runSteps(steps);
        for (const side of ['A', 'B'] as const) {
          let deposited = 0n;
          let withdrawn = 0n;
          for (const e of accepted) {
            if (e.type === 'back' && e.side === side) deposited += e.units;
            if (e.type === 'exit' && e.side === side) withdrawn += e.units;
          }
          expect(state.sides[side].units).toBe(deposited - withdrawn);
          let held = 0n;
          for (const p of Object.values(state.positions)) if (p.side === side) held += p.units;
          expect(held).toBe(deposited - withdrawn);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('fees: pool + protocol + creator == Σ fees paid, exactly', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 40 }), (steps) => {
        const { state, accepted } = runSteps(steps);
        const paid = accepted.reduce((s, e) => (e.type === 'back' ? s + e.feePaid : s), 0n);
        const pool = state.settlement?.poolAtSettlement ?? 0n;
        const upset = state.settlement?.upsetBonus ?? 0n;
        expect(pool - upset + state.protocolFees + state.creatorFees).toBe(paid);
      }),
      { numRuns: 100 },
    );
  });

  it('settlement clamp never increases any weight and never changes the honest (1.0×) ones', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 30 }), (steps) => {
        const plain = runSteps(steps, { clamp: false }).state;
        const clamped = runSteps(steps, { clamp: true }).state;
        const wp = new Map(finalWinningWeights(plain).map((x) => [x.key, x.weight]));
        const wc = new Map(finalWinningWeights(clamped).map((x) => [x.key, x.weight]));
        for (const [k, v] of wc) {
          const before = wp.get(k) ?? 0n;
          expect(v).toBeLessThanOrEqual(before);
          const p = clamped.positions[k];
          // honest 1.0× positions: identical up to exit-rounding dust (< 1e4 unit-seconds)
          if (p && p.units > 0n && p.effUnits === p.units * ONE_Q4)
            expect(before - v).toBeLessThan(ONE_Q4);
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('pure-function properties', () => {
  it('splitFee conserves and never exceeds input', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (fee) => {
        const r = splitFee(fee, DEFAULT_FEE_POLICY);
        expect(r.toPool + r.toProtocol + r.toCreator).toBe(fee);
        expect(r.toPool).toBeLessThanOrEqual(fee);
        expect(r.toCreator).toBeLessThanOrEqual(fee);
      }),
    );
  });
  it('distribution: Σ ≤ pool, remainder ≥ 0, zero weights pay zero, monotone in weight', () => {
    const modes: DistributionMode[] = ['HardCap', 'WaterFill', 'ConditionalCap', 'Proportional'];
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 30n }), { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...modes),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (pool, weights, mode, cap) => {
          const positions: WeightedPosition[] = weights.map((w, i) => ({
            key: `p${i}`,
            weight: w,
          }));
          const r = distribute(mode, pool, positions, cap);
          expect(r.distributed + r.remainder).toBe(pool);
          expect(r.remainder).toBeGreaterThanOrEqual(0n);
          const sorted = [...positions].sort((a, b) =>
            a.weight < b.weight ? -1 : a.weight > b.weight ? 1 : 0,
          );
          let last = -1n;
          for (const p of sorted) {
            const v = r.payouts.get(p.key) ?? 0n;
            if (p.weight === 0n) expect(v).toBe(0n);
            expect(v).toBeGreaterThanOrEqual(last);
            last = v;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

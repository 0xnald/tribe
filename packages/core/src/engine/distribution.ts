import { assertU128, minBig } from '../math/fixed';
import { ErrorCode, fail } from './errors';

/**
 * Reward distribution utilities — INTERNAL / analysis only.
 *
 * The normative protocol rule (ECONOMICS §6.1) is proportional payout with
 * no per-position cap, implemented O(1) in `arena.ts` (`payoutProportional`).
 * The capped variants below (HardCap, WaterFill, ConditionalCap) were the
 * Phase 1 comparison set and are kept for tests and analysis; they are not
 * exposed to Arena creators and are not part of the on-chain program.
 * Every mode guarantees Σ payouts ≤ pool with floor division.
 */

export type DistributionMode = 'Proportional' | 'HardCap' | 'WaterFill' | 'ConditionalCap';

export interface WeightedPosition {
  key: string;
  weight: bigint;
}

export interface DistributionResult {
  payouts: Map<string, bigint>;
  distributed: bigint;
  remainder: bigint;
  /** Effective cap in bps actually applied (10_000 = uncapped). */
  effectiveCapBps: bigint;
}

function checkInputs(pool: bigint, positions: readonly WeightedPosition[]): bigint {
  if (pool < 0n) fail(ErrorCode.InvalidParams, 'negative pool');
  let total = 0n;
  for (const p of positions) {
    if (p.weight < 0n) fail(ErrorCode.InvalidParams, `negative weight for ${p.key}`);
    total = assertU128(total + p.weight, 'w_total');
  }
  return total;
}

/** O(1) per-position payout with a hard cap — the on-chain `claim` formula. */
export function payoutHardCap(
  pool: bigint,
  weight: bigint,
  wTotal: bigint,
  capBps: bigint,
): bigint {
  if (wTotal === 0n || weight === 0n) return 0n;
  const proportional = (pool * weight) / wTotal;
  const cap = (pool * capBps) / 10_000n;
  return minBig(proportional, cap);
}

/** Pure proportional (cap = 100 %). */
export function distributeProportional(
  pool: bigint,
  positions: readonly WeightedPosition[],
): DistributionResult {
  return distributeHardCap(pool, positions, 10_000n);
}

/** A. Hard per-position cap; the remainder rolls over. */
export function distributeHardCap(
  pool: bigint,
  positions: readonly WeightedPosition[],
  capBps: bigint,
): DistributionResult {
  const wTotal = checkInputs(pool, positions);
  const payouts = new Map<string, bigint>();
  let distributed = 0n;
  for (const p of positions) {
    const pay = payoutHardCap(pool, p.weight, wTotal, capBps);
    payouts.set(p.key, pay);
    distributed += pay;
  }
  return { payouts, distributed, remainder: pool - distributed, effectiveCapBps: capBps };
}

/**
 * B. Iterative capped redistribution (water-filling). Positions whose
 * proportional share of the *remaining* pool exceeds the cap are fixed at
 * the cap; the rest of the pool is re-shared among the uncapped positions
 * until no violation remains or everyone is capped. Order-independent
 * because all violators of a pass are capped together.
 */
export function distributeWaterFill(
  pool: bigint,
  positions: readonly WeightedPosition[],
  capBps: bigint,
): DistributionResult {
  checkInputs(pool, positions);
  const capAmount = (pool * capBps) / 10_000n;
  const payouts = new Map<string, bigint>();
  let uncapped = positions.filter((p) => p.weight > 0n);
  for (const p of positions) if (p.weight === 0n) payouts.set(p.key, 0n);
  let remaining = pool;
  let wRemaining = uncapped.reduce((s, p) => s + p.weight, 0n);

  for (let pass = 0; pass <= positions.length && uncapped.length > 0; pass++) {
    const violators = uncapped.filter((p) => (remaining * p.weight) / wRemaining > capAmount);
    if (violators.length === 0) break;
    for (const v of violators) {
      payouts.set(v.key, capAmount);
      remaining -= capAmount;
      wRemaining -= v.weight;
    }
    const capped = new Set(violators.map((v) => v.key));
    uncapped = uncapped.filter((p) => !capped.has(p.key));
  }
  for (const p of uncapped) {
    payouts.set(p.key, wRemaining === 0n ? 0n : (remaining * p.weight) / wRemaining);
  }
  let distributed = 0n;
  for (const v of payouts.values()) distributed += v;
  return { payouts, distributed, remainder: pool - distributed, effectiveCapBps: capBps };
}

/**
 * C. Conditional cap: the cap only binds when there are enough winners for
 * it to be meaningful — effective cap = max(cap, ceil(10_000 / n_winners)).
 * One winner is uncapped, two winners are capped at 50 %, four or more at
 * the configured cap. Remainder rolls over as in A.
 */
export function distributeConditionalCap(
  pool: bigint,
  positions: readonly WeightedPosition[],
  capBps: bigint,
): DistributionResult {
  const n = BigInt(positions.filter((p) => p.weight > 0n).length);
  const floorCap = n === 0n ? 10_000n : (10_000n + n - 1n) / n;
  const eff = capBps > floorCap ? capBps : floorCap;
  return distributeHardCap(pool, positions, eff);
}

export function distribute(
  mode: DistributionMode,
  pool: bigint,
  positions: readonly WeightedPosition[],
  capBps: bigint,
): DistributionResult {
  switch (mode) {
    case 'Proportional':
      return distributeProportional(pool, positions);
    case 'HardCap':
      return distributeHardCap(pool, positions, capBps);
    case 'WaterFill':
      return distributeWaterFill(pool, positions, capBps);
    case 'ConditionalCap':
      return distributeConditionalCap(pool, positions, capBps);
  }
}

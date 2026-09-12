import {
  DEFAULT_ARENA_PARAMS,
  DEFAULT_FEE_POLICY,
  DEFAULT_PROTOCOL_LIMITS,
  type FeePolicy,
  type UnderdogPolicy,
} from '../config/policy';
import {
  accruePosition,
  accrueSide,
  applyDeposit,
  applyExit,
  newPosition,
} from '../engine/accrual';
import {
  applyEvent,
  createArena,
  phaseOf,
  positionRewardWeight,
  type ArenaEvent,
} from '../engine/arena';
import { distribute } from '../engine/distribution';
import { isTribeError } from '../engine/errors';
import { feeRequired, splitFee } from '../engine/fees';
import { validatePriceUpdate, type PriceInput } from '../engine/oracle';
import { settleFromPrices } from '../engine/settlement';
import { instantShareAfterDepositBps, twabShareBps } from '../engine/twab';
import {
  ZERO_SIDE,
  type ArenaAssetSpec,
  type ArenaConfig,
  type DistributionMode,
  type SideId,
  type SideState,
} from '../engine/types';
import { underdogMultiplier } from '../engine/underdog';
import { computeUpsetBonus } from '../engine/upset';
import { decideWinner, notionalUsdc, perfBps, refPriceQ8, toQ8 } from '../math/fixed';
import { BONK, DAY, HOUR, T0, TSLA_PRICE_Q8, TSLAX } from '../testing/fixtures';
import { arr, big, bool, num, obj, optBig, str, type Json } from './codec';

/**
 * Test-vector builder. Each category has:
 *   - `cases`: named inputs (the *source of truth* for what is covered),
 *   - `run`:   the reference computation producing `expected`,
 *   - `decode`: how to read `inputs` back from JSON (used by the verifier and
 *              mirrors what the Rust loader must do).
 * The generator writes `expected = run(inputs)`; the verifier recomputes and
 * compares, so a committed vector can never drift from the engine silently.
 */

export const VECTOR_SCHEMA = 'tribe-core-vectors';
export const VECTOR_VERSION = 1;

export interface Vector<I> {
  name: string;
  description: string;
  inputs: I;
}

export interface Category<I> {
  category: string;
  cases: Vector<I>[];
  run(inputs: I): unknown;
  decode(json: Json): I;
}

// ─────────────────────────────────────────────────────────────── helpers

function decodeAsset(j: Json | undefined): ArenaAssetSpec {
  const o = obj(j);
  return {
    mint: str(o.mint),
    decimals: num(o.decimals),
    assetClass: str(o.assetClass) as ArenaAssetSpec['assetClass'],
    feedId: str(o.feedId),
    scaledUi: bool(o.scaledUi),
    toleranceSecs: big(o.toleranceSecs),
    maxClosedStalenessSecs: big(o.maxClosedStalenessSecs),
    maxConfBps: big(o.maxConfBps),
  };
}

function decodePriceInput(j: Json | undefined): PriceInput {
  const o = obj(j);
  const p: PriceInput = {
    feedId: str(o.feedId),
    price: big(o.price),
    conf: big(o.conf),
    expo: num(o.expo),
    publishTime: big(o.publishTime),
    verificationLevel: str(o.verificationLevel) as PriceInput['verificationLevel'],
  };
  const m = optBig(o.multQ6);
  if (m !== null) p.multQ6 = m;
  return p;
}

function decodeUnderdogPolicy(j: Json | undefined): UnderdogPolicy {
  const o = obj(j);
  return {
    slope: num(o.slope),
    capQ4: num(o.capQ4),
    warmupBps: num(o.warmupBps),
    warmupFloorSecs: num(o.warmupFloorSecs),
  };
}

function decodeFeePolicy(j: Json | undefined): FeePolicy {
  const o = obj(j);
  const s = obj(o.split);
  return {
    feeBps: num(o.feeBps),
    split: {
      rewardPoolBps: num(s.rewardPoolBps),
      protocolBps: num(s.protocolBps),
      creatorBps: num(s.creatorBps),
    },
    creatorShareTarget: str(o.creatorShareTarget) as FeePolicy['creatorShareTarget'],
  };
}

function price(
  asset: ArenaAssetSpec,
  priceQ8: bigint,
  publishTime: bigint,
  extra: Partial<PriceInput> = {},
): PriceInput {
  return {
    feedId: asset.feedId,
    price: priceQ8,
    expo: -8,
    conf: 0n,
    publishTime,
    verificationLevel: 'Full',
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────── math

interface MathCase {
  op: 'toQ8' | 'refPriceQ8' | 'notionalUsdc' | 'perfBps' | 'decideWinner';
  args: bigint[];
  numArgs?: number[];
}

export const mathCategory: Category<MathCase> = {
  category: 'math',
  cases: [
    {
      name: 'toQ8 expo -8 identity',
      description: '$365.25 at expo -8',
      inputs: { op: 'toQ8', args: [36_525_000_000n], numArgs: [-8] },
    },
    {
      name: 'toQ8 expo -2',
      description: '$365.25 at expo -2',
      inputs: { op: 'toQ8', args: [36_525n], numArgs: [-2] },
    },
    {
      name: 'toQ8 expo -15 floors',
      description: 'BONK 2816164455e-15',
      inputs: { op: 'toQ8', args: [2_816_164_455n], numArgs: [-15] },
    },
    {
      name: 'refPriceQ8 dividend 1.008',
      description: '',
      inputs: { op: 'refPriceQ8', args: [10_000_000_000n, 1_008_000n] },
    },
    {
      name: 'refPriceQ8 split 4x',
      description: '$91.3125 × 4.0 = $365.25',
      inputs: { op: 'refPriceQ8', args: [9_131_250_000n, 4_000_000n] },
    },
    {
      name: 'notional TSLAx',
      description: '0.27337718 TSLAx at $365.25',
      inputs: { op: 'notionalUsdc', args: [27_337_718n, 36_525_000_000n], numArgs: [8] },
    },
    {
      name: 'notional BONK',
      description: '35M BONK at $0.00000281',
      inputs: { op: 'notionalUsdc', args: [3_500_000_000_000n, 281n], numArgs: [5] },
    },
    {
      name: 'notional dust floors to zero',
      description: '',
      inputs: { op: 'notionalUsdc', args: [1n, 1n], numArgs: [8] },
    },
    {
      name: 'perfBps +8.42%',
      description: '',
      inputs: { op: 'perfBps', args: [10_000_000_000n, 10_842_000_000n] },
    },
    {
      name: 'perfBps -2.17%',
      description: '',
      inputs: { op: 'perfBps', args: [10_000_000_000n, 9_783_000_000n] },
    },
    {
      name: 'perfBps floor negative',
      description: '-0.1 bps floors to -1',
      inputs: { op: 'perfBps', args: [10_000_000_000n, 9_999_900_000n] },
    },
    {
      name: 'winner A',
      description: '+8.42% vs +2.17%',
      inputs: {
        op: 'decideWinner',
        args: [10_000_000_000n, 10_842_000_000n, 10_000_000_000n, 10_217_000_000n, 1n],
      },
    },
    {
      name: 'winner tie on band',
      description: '+1 bps vs flat, band 1 bps',
      inputs: {
        op: 'decideWinner',
        args: [10_000_000_000n, 10_001_000_000n, 10_000_000_000n, 10_000_000_000n, 1n],
      },
    },
    {
      name: 'winner A beyond band',
      description: '+1 bps + 1 unit',
      inputs: {
        op: 'decideWinner',
        args: [10_000_000_000n, 10_001_000_001n, 10_000_000_000n, 10_000_000_000n, 1n],
      },
    },
    {
      name: 'winner across scales',
      description: 'BONK 281→281 vs TSLA +2 bps',
      inputs: { op: 'decideWinner', args: [281n, 281n, 10_000_000_000n, 10_002_000_000n, 1n] },
    },
    {
      name: 'winner both down',
      description: 'A -5% vs B -9% → A',
      inputs: {
        op: 'decideWinner',
        args: [10_000_000_000n, 9_500_000_000n, 10_000_000_000n, 9_100_000_000n, 1n],
      },
    },
    {
      name: 'winner extreme ratio',
      description: '1→2 vs 1e16→1.9e16',
      inputs: {
        op: 'decideWinner',
        args: [1n, 2n, 10_000_000_000_000_000n, 19_000_000_000_000_000n, 1n],
      },
    },
  ],
  run(i) {
    const a = i.args;
    const n = i.numArgs ?? [];
    switch (i.op) {
      case 'toQ8':
        return { result: toQ8(a[0] ?? 0n, n[0] ?? 0) };
      case 'refPriceQ8':
        return { result: refPriceQ8(a[0] ?? 0n, a[1] ?? 0n) };
      case 'notionalUsdc':
        return { result: notionalUsdc(a[0] ?? 0n, a[1] ?? 0n, n[0] ?? 0) };
      case 'perfBps':
        return { result: perfBps(a[0] ?? 0n, a[1] ?? 0n) };
      case 'decideWinner':
        return { result: decideWinner(a[0] ?? 0n, a[1] ?? 0n, a[2] ?? 0n, a[3] ?? 0n, a[4] ?? 0n) };
    }
  },
  decode(j) {
    const o = obj(j);
    const out: MathCase = { op: str(o.op) as MathCase['op'], args: arr(o.args).map((x) => big(x)) };
    if (o.numArgs !== undefined) out.numArgs = arr(o.numArgs).map((x) => num(x));
    return out;
  },
};

// ─────────────────────────────────────────────────────────────── accrual

interface AccrualOp {
  op: 'deposit' | 'exit' | 'accrue';
  now: bigint;
  units?: bigint;
  mQ4?: bigint;
  forfeit?: boolean;
}
interface AccrualCase {
  startTs: bigint;
  endTs: bigint;
  ops: AccrualOp[];
}

export const accrualCategory: Category<AccrualCase> = {
  category: 'accrual',
  cases: [
    {
      name: 'single deposit held to end',
      description: '100 units × 1.0 for the whole window',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 100n, mQ4: 10_000n },
          { op: 'accrue', now: 87_400n },
        ],
      },
    },
    {
      name: 'accrual clamps outside the window',
      description: 'touch before start and after end count nothing',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 5n, mQ4: 10_000n },
          { op: 'accrue', now: 1000n },
          { op: 'accrue', now: 87_400n },
          { op: 'accrue', now: 999_999n },
        ],
      },
    },
    {
      name: 'repeated accrual same timestamp',
      description: 'no double counting',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 100n, mQ4: 10_000n },
          { op: 'accrue', now: 2000n },
          { op: 'accrue', now: 2000n },
          { op: 'accrue', now: 2000n },
        ],
      },
    },
    {
      name: 'two tranches different multipliers',
      description: '10 × 1.0 then 10 × 1.5',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 10n, mQ4: 10_000n },
          { op: 'deposit', now: 11_000n, units: 10n, mQ4: 15_000n },
          { op: 'accrue', now: 21_000n },
        ],
      },
    },
    {
      name: 'partial exit proportional forfeiture',
      description: '100 held 10 000 s, exit 25 with forfeit',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 100n, mQ4: 10_000n },
          { op: 'exit', now: 11_000n, units: 25n, forfeit: true },
          { op: 'accrue', now: 21_000n },
        ],
      },
    },
    {
      name: 'full exit before end forfeits all',
      description: '',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 100n, mQ4: 10_000n },
          { op: 'exit', now: 11_000n, units: 100n, forfeit: true },
        ],
      },
    },
    {
      name: 'exit after end keeps weight',
      description: 'forfeit=false moves units only',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 100n, mQ4: 10_000n },
          { op: 'accrue', now: 87_400n },
          { op: 'exit', now: 90_000n, units: 100n, forfeit: false },
        ],
      },
    },
    {
      name: 'exit rounding favours the pool',
      description: '3 units, 7 unit-seconds, exit 1 → keep floor(7×2/3)=4',
      inputs: {
        startTs: 1000n,
        endTs: 87_400n,
        ops: [
          { op: 'deposit', now: 1000n, units: 3n, mQ4: 10_000n },
          { op: 'accrue', now: 1000n },
          { op: 'exit', now: 1000n, units: 1n, forfeit: true },
        ],
      },
    },
    {
      name: 'large values near u64 units for 30 days',
      description: 'overflow boundary: 1e18 units × 2.0× × 2 592 000 s fits u128',
      inputs: {
        startTs: 0n,
        endTs: 2_592_000n,
        ops: [
          { op: 'deposit', now: 0n, units: 1_000_000_000_000_000_000n, mQ4: 20_000n },
          { op: 'accrue', now: 2_592_000n },
        ],
      },
    },
  ],
  run(i) {
    const w = { startTs: i.startTs, endTs: i.endTs };
    let p = newPosition('u', 'A', i.ops[0]?.now ?? i.startTs);
    let side: SideState = { ...ZERO_SIDE };
    let last = p.lastTouchTs;
    const steps: unknown[] = [];
    for (const op of i.ops) {
      // the side aggregate accrues by the same clamped delta as the position
      const dt = clampDelta(last, op.now, w);
      p = accruePosition(p, op.now, w);
      side = accrueSide(side, dt);
      last = p.lastTouchTs;
      if (op.op === 'deposit')
        ({ position: p, side } = applyDeposit(p, side, op.units ?? 0n, op.mQ4 ?? 10_000n, 0n));
      else if (op.op === 'exit')
        ({ position: p, side } = applyExit(p, side, op.units ?? 0n, op.forfeit ?? true));
      steps.push({
        op: op.op,
        now: op.now,
        position: {
          units: p.units,
          unitSeconds: p.unitSeconds,
          effUnits: p.effUnits,
          effUnitSeconds: p.effUnitSeconds,
          forfeited: p.forfeited,
        },
        side: {
          units: side.units,
          unitSeconds: side.unitSeconds,
          effUnits: side.effUnits,
          effUnitSeconds: side.effUnitSeconds,
          participants: side.participants,
        },
      });
    }
    return { steps };
  },
  decode(j) {
    const o = obj(j);
    return {
      startTs: big(o.startTs),
      endTs: big(o.endTs),
      ops: arr(o.ops).map((x) => {
        const op = obj(x);
        const out: AccrualOp = { op: str(op.op) as AccrualOp['op'], now: big(op.now) };
        if (op.units !== undefined) out.units = big(op.units);
        if (op.mQ4 !== undefined) out.mQ4 = big(op.mQ4);
        if (op.forfeit !== undefined) out.forfeit = bool(op.forfeit);
        return out;
      }),
    };
  },
};

function clampDelta(last: bigint, now: bigint, w: { startTs: bigint; endTs: bigint }): bigint {
  const c = (t: bigint) => (t < w.startTs ? w.startTs : t > w.endTs ? w.endTs : t);
  return c(now) - c(last);
}

// ─────────────────────────────────────────────────────────────── underdog

interface UnderdogCase {
  sides: Record<SideId, { units: bigint; unitSeconds: bigint }>;
  prices: Record<SideId, bigint>;
  decimals: Record<SideId, number>;
  side: SideId;
  depositUnits: bigint;
  now: bigint;
  startTs: bigint;
  endTs: bigint;
  policy: UnderdogPolicy;
}

const UD = DEFAULT_ARENA_PARAMS.underdog;
const bonk = (usd: bigint) => (usd * 100_000_000n * 100_000n) / 281n;
const tsla = (usd: bigint) => (usd * 100_000_000n * 100_000_000n) / TSLA_PRICE_Q8;
const ud = (o: Partial<UnderdogCase>): UnderdogCase => ({
  sides: { A: { units: 0n, unitSeconds: 0n }, B: { units: 0n, unitSeconds: 0n } },
  prices: { A: 281n, B: TSLA_PRICE_Q8 },
  decimals: { A: 5, B: 8 },
  side: 'B',
  depositUnits: tsla(1000n),
  now: 0n,
  startTs: 0n,
  endTs: DAY,
  policy: UD,
  ...o,
});

export const underdogCategory: Category<UnderdogCase> = {
  category: 'underdog',
  cases: [
    { name: 'first backer is 1.0x', description: 'empty arena', inputs: ud({ now: 0n }) },
    {
      name: 'balanced instant, no TWAB, t=0',
      description: 'ramp 0',
      inputs: ud({
        sides: { A: { units: bonk(1000n), unitSeconds: 0n }, B: { units: 0n, unitSeconds: 0n } },
      }),
    },
    {
      name: '20% underdog after warm-up',
      description: 'A 80k, B 20k deposit, instant=TWAB=20%',
      inputs: ud({
        sides: {
          A: { units: bonk(80_000n), unitSeconds: bonk(80_000n) * 3n * HOUR },
          B: { units: bonk(0n), unitSeconds: 0n },
        },
        depositUnits: tsla(20_000n),
        now: 3n * HOUR,
      }),
    },
    {
      name: 'half-way through warm-up',
      description: 'same as above at 864 s of 8640',
      inputs: ud({
        sides: {
          A: { units: bonk(80_000n), unitSeconds: bonk(80_000n) * 864n },
          B: { units: 0n, unitSeconds: 0n },
        },
        depositUnits: tsla(20_000n),
        now: 864n,
      }),
    },
    {
      name: 'max(instant, twab): flash imbalance ignored',
      description: 'A just got 40k but TWAB says 50/50',
      inputs: ud({
        sides: {
          A: { units: bonk(50_000n), unitSeconds: bonk(10_000n) * 6n * HOUR },
          B: { units: tsla(10_000n), unitSeconds: tsla(10_000n) * 6n * HOUR },
        },
        depositUnits: tsla(10_000n),
        now: 6n * HOUR,
      }),
    },
    {
      name: 'majority side gets 1.0x',
      description: 'B is 99%',
      inputs: ud({
        sides: {
          A: { units: bonk(1000n), unitSeconds: bonk(1000n) * 12n * HOUR },
          B: { units: tsla(1000n), unitSeconds: tsla(1000n) * 12n * HOUR },
        },
        depositUnits: tsla(100_000n),
        now: 12n * HOUR,
      }),
    },
    {
      name: 'cap at 2.0x',
      description: 'tiny underdog deposit after warm-up',
      inputs: ud({
        sides: {
          A: { units: bonk(1_000_000n), unitSeconds: bonk(1_000_000n) * 12n * HOUR },
          B: { units: 0n, unitSeconds: 0n },
        },
        depositUnits: tsla(6n),
        now: 12n * HOUR,
      }),
    },
    {
      name: 'short arena warm-up floor',
      description: '1 h arena, 15 min in: ramp 0.5',
      inputs: ud({
        sides: {
          A: { units: bonk(8000n), unitSeconds: bonk(8000n) * 900n },
          B: { units: 0n, unitSeconds: 0n },
        },
        depositUnits: tsla(2000n),
        now: 900n,
        endTs: HOUR,
      }),
    },
    {
      name: 'custom policy slope 4 cap 1.5',
      description: '',
      inputs: ud({
        sides: {
          A: { units: bonk(80_000n), unitSeconds: bonk(80_000n) * 3n * HOUR },
          B: { units: 0n, unitSeconds: 0n },
        },
        depositUnits: tsla(20_000n),
        now: 3n * HOUR,
        policy: { slope: 4, capQ4: 15_000, warmupBps: 1000, warmupFloorSecs: 1800 },
      }),
    },
  ],
  run(i) {
    const sides: Record<SideId, SideState> = {
      A: { ...ZERO_SIDE, units: i.sides.A.units, unitSeconds: i.sides.A.unitSeconds },
      B: { ...ZERO_SIDE, units: i.sides.B.units, unitSeconds: i.sides.B.unitSeconds },
    };
    const valuations = {
      A: { priceQ8: i.prices.A, decimals: i.decimals.A },
      B: { priceQ8: i.prices.B, decimals: i.decimals.B },
    };
    const r = underdogMultiplier({
      sides,
      valuations,
      side: i.side,
      depositUnits: i.depositUnits,
      now: i.now,
      startTs: i.startTs,
      endTs: i.endTs,
      policy: i.policy,
    });
    return {
      shareInstBps: instantShareAfterDepositBps({ sides, valuations }, i.side, i.depositUnits),
      shareTwabBps: twabShareBps({ sides, valuations }, i.side),
      shareEffBps: r.shareEffBps,
      rawQ4: r.rawQ4,
      warmupSecs: r.warmup,
      elapsedSecs: r.elapsed,
      mQ4: r.mQ4,
    };
  },
  decode(j) {
    const o = obj(j);
    const sides = obj(o.sides);
    const sd = (k: SideId) => {
      const s = obj(sides[k]);
      return { units: big(s.units), unitSeconds: big(s.unitSeconds) };
    };
    const prices = obj(o.prices);
    const dec = obj(o.decimals);
    return {
      sides: { A: sd('A'), B: sd('B') },
      prices: { A: big(prices.A), B: big(prices.B) },
      decimals: { A: num(dec.A), B: num(dec.B) },
      side: str(o.side) as SideId,
      depositUnits: big(o.depositUnits),
      now: big(o.now),
      startTs: big(o.startTs),
      endTs: big(o.endTs),
      policy: decodeUnderdogPolicy(o.policy),
    };
  },
};

// ─────────────────────────────────────────────────────────────── fees

interface FeeCase {
  notionalUsdc: bigint;
  policy: FeePolicy;
}

export const feesCategory: Category<FeeCase> = {
  category: 'fees',
  cases: [
    {
      name: '100 USDC default',
      description: '',
      inputs: { notionalUsdc: 100_000_000n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: '99.999999 USDC floors',
      description: '',
      inputs: { notionalUsdc: 99_999_999n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: 'minimum backing 5 USDC',
      description: '',
      inputs: { notionalUsdc: 5_000_000n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: 'tiny 199 micro → zero fee',
      description: '',
      inputs: { notionalUsdc: 199n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: 'tiny 200 micro → 1',
      description: '',
      inputs: { notionalUsdc: 200n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: 'odd split 7 micro fee',
      description: 'protocol absorbs rounding',
      inputs: { notionalUsdc: 1400n, policy: DEFAULT_FEE_POLICY },
    },
    {
      name: 'first-party creator → RewardPool',
      description: '',
      inputs: {
        notionalUsdc: 100_000_000n,
        policy: { ...DEFAULT_FEE_POLICY, creatorShareTarget: 'RewardPool' },
      },
    },
    {
      name: 'creator → Protocol',
      description: '',
      inputs: {
        notionalUsdc: 100_000_000n,
        policy: { ...DEFAULT_FEE_POLICY, creatorShareTarget: 'Protocol' },
      },
    },
    {
      name: 'custom 1% fee 50/30/20',
      description: '',
      inputs: {
        notionalUsdc: 12_345_678n,
        policy: {
          feeBps: 100,
          split: { rewardPoolBps: 5000, protocolBps: 3000, creatorBps: 2000 },
          creatorShareTarget: 'Creator',
        },
      },
    },
    {
      name: 'u64-scale notional',
      description: '',
      inputs: { notionalUsdc: 18_000_000_000_000_000_000n / 10n, policy: DEFAULT_FEE_POLICY },
    },
  ],
  run(i) {
    const fee = feeRequired(i.notionalUsdc, i.policy.feeBps);
    return { feeRequired: fee, split: splitFee(fee, i.policy) };
  },
  decode(j) {
    const o = obj(j);
    return { notionalUsdc: big(o.notionalUsdc), policy: decodeFeePolicy(o.policy) };
  },
};

// ─────────────────────────────────────────────────────────────── settlement / oracle

interface OracleCase {
  input: PriceInput;
  asset: ArenaAssetSpec;
  targetTs: bigint;
  allowClosed: boolean;
}

const T = 1_760_000_000n;
export const oracleCategory: Category<OracleCase> = {
  category: 'oracle',
  cases: [
    {
      name: 'exact window ok',
      description: '',
      inputs: { input: price(BONK, 281n, T + 59n), asset: BONK, targetTs: T, allowClosed: false },
    },
    {
      name: 'expo normalisation',
      description: 'expo -11',
      inputs: {
        input: price(BONK, 281_000n, T, { expo: -11 }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'feed mismatch',
      description: '',
      inputs: {
        input: price(BONK, 281n, T, { feedId: TSLAX.feedId }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'partial verification',
      description: '',
      inputs: {
        input: price(BONK, 281n, T, { verificationLevel: 'Partial' }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'zero price',
      description: '',
      inputs: { input: price(BONK, 0n, T), asset: BONK, targetTs: T, allowClosed: false },
    },
    {
      name: 'negative price',
      description: '',
      inputs: { input: price(BONK, -5n, T), asset: BONK, targetTs: T, allowClosed: false },
    },
    {
      name: 'confidence at limit ok',
      description: '100 bps',
      inputs: {
        input: price(BONK, 10_000n, T, { conf: 100n }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'confidence too wide',
      description: '101 bps',
      inputs: {
        input: price(BONK, 10_000n, T, { conf: 101n }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'future print rejected',
      description: '+61 s',
      inputs: { input: price(BONK, 281n, T + 61n), asset: BONK, targetTs: T, allowClosed: false },
    },
    {
      name: 'stale crypto rejected',
      description: '-61 s',
      inputs: { input: price(BONK, 281n, T - 61n), asset: BONK, targetTs: T, allowClosed: false },
    },
    {
      name: 'equity last-known not allowed',
      description: '',
      inputs: {
        input: price(TSLAX, TSLA_PRICE_Q8, T - 50n * HOUR),
        asset: TSLAX,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'equity last-known allowed',
      description: '',
      inputs: {
        input: price(TSLAX, TSLA_PRICE_Q8, T - 50n * HOUR),
        asset: TSLAX,
        targetTs: T,
        allowClosed: true,
      },
    },
    {
      name: 'equity beyond 72h',
      description: '',
      inputs: {
        input: price(TSLAX, TSLA_PRICE_Q8, T - 73n * HOUR),
        asset: TSLAX,
        targetTs: T,
        allowClosed: true,
      },
    },
    {
      name: 'scaled multiplier applied',
      description: '4.032×',
      inputs: {
        input: price(TSLAX, TSLA_PRICE_Q8, T, { multQ6: 4_032_000n }),
        asset: TSLAX,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'multiplier ignored for non-scaled',
      description: '',
      inputs: {
        input: price(BONK, 281n, T, { multQ6: 4_000_000n }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'zero multiplier rejected',
      description: '',
      inputs: {
        input: price(TSLAX, TSLA_PRICE_Q8, T, { multQ6: 0n }),
        asset: TSLAX,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'unsupported exponent',
      description: 'expo -20',
      inputs: {
        input: price(BONK, 281n, T, { expo: -20 }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
    {
      name: 'overflow boundary',
      description: '2^63 at expo +8',
      inputs: {
        input: price(BONK, 1n << 63n, T, { expo: 8 }),
        asset: BONK,
        targetTs: T,
        allowClosed: false,
      },
    },
  ],
  run(i) {
    const r = validatePriceUpdate(i.input, i.asset, i.targetTs, i.allowClosed);
    return r.ok ? { ok: true, snapshot: r.snapshot } : { ok: false, code: r.code };
  },
  decode(j) {
    const o = obj(j);
    return {
      input: decodePriceInput(o.input),
      asset: decodeAsset(o.asset),
      targetTs: big(o.targetTs),
      allowClosed: bool(o.allowClosed),
    };
  },
};

interface SettleCase {
  A: { startQ8: bigint; endQ8: bigint };
  B: { startQ8: bigint; endQ8: bigint };
  tieBps: bigint;
}
const S = 10_000_000_000n;
export const settlementCategory: Category<SettleCase> = {
  category: 'settlement',
  cases: [
    {
      name: 'equal returns tie',
      description: '',
      inputs: { A: { startQ8: S, endQ8: S }, B: { startQ8: S, endQ8: S }, tieBps: 1n },
    },
    {
      name: '+1 bps exactly is tie',
      description: '',
      inputs: {
        A: { startQ8: S, endQ8: 10_001_000_000n },
        B: { startQ8: S, endQ8: S },
        tieBps: 1n,
      },
    },
    {
      name: '+1 bps + 1 unit A wins',
      description: '',
      inputs: {
        A: { startQ8: S, endQ8: 10_001_000_001n },
        B: { startQ8: S, endQ8: S },
        tieBps: 1n,
      },
    },
    {
      name: '-1 bps - 1 unit B wins',
      description: '',
      inputs: { A: { startQ8: S, endQ8: 9_998_999_999n }, B: { startQ8: S, endQ8: S }, tieBps: 1n },
    },
    {
      name: 'zero band',
      description: '',
      inputs: { A: { startQ8: S, endQ8: S + 1n }, B: { startQ8: S, endQ8: S }, tieBps: 0n },
    },
    {
      name: 'wide band 100 bps',
      description: '+0.5% vs flat is a tie',
      inputs: {
        A: { startQ8: S, endQ8: 10_050_000_000n },
        B: { startQ8: S, endQ8: S },
        tieBps: 100n,
      },
    },
    {
      name: 'BONK vs TSLAx demo',
      description: 'BONK 281→300 (+6.76%), TSLAx +2.17%',
      inputs: {
        A: { startQ8: 281n, endQ8: 300n },
        B: { startQ8: TSLA_PRICE_Q8, endQ8: 37_317_592_500n },
        tieBps: 1n,
      },
    },
    {
      name: 'split continuity',
      description: 'TSLAx 4:1 split via multiplier is flat',
      inputs: {
        A: { startQ8: 281n, endQ8: 281n },
        B: { startQ8: TSLA_PRICE_Q8, endQ8: (9_131_250_000n * 4_000_000n) / 1_000_000n },
        tieBps: 1n,
      },
    },
    {
      name: 'extreme ratio',
      description: '',
      inputs: {
        A: { startQ8: 1n, endQ8: 2n },
        B: { startQ8: 10_000_000_000_000_000n, endQ8: 19_000_000_000_000_000n },
        tieBps: 1n,
      },
    },
    {
      name: 'both crash A less',
      description: '',
      inputs: {
        A: { startQ8: S, endQ8: 5_000_000_000n },
        B: { startQ8: S, endQ8: 4_000_000_000n },
        tieBps: 1n,
      },
    },
  ],
  run(i) {
    return settleFromPrices({ A: i.A, B: i.B }, i.tieBps);
  },
  decode(j) {
    const o = obj(j);
    const sd = (k: SideId) => {
      const s = obj(o[k]);
      return { startQ8: big(s.startQ8), endQ8: big(s.endQ8) };
    };
    return { A: sd('A'), B: sd('B'), tieBps: big(o.tieBps) };
  },
};

// ─────────────────────────────────────────────────────────────── distribution

interface DistCase {
  mode: DistributionMode;
  pool: bigint;
  capBps: bigint;
  weights: { key: string; weight: bigint }[];
}
const M = 100_000n;
const EX = [
  { key: 'alice', weight: 864n * M },
  { key: 'bob', weight: 1440n * M },
  { key: 'erin', weight: 4320n * M },
  { key: 'frank', weight: 576n * M },
];
const modes: DistributionMode[] = ['HardCap', 'WaterFill', 'ConditionalCap', 'Proportional'];
export const distributionCategory: Category<DistCase> = {
  category: 'distribution',
  cases: [
    ...modes.map((mode) => ({
      name: `${mode} worked example`,
      description: 'ECONOMICS §6.5',
      inputs: { mode, pool: 4_000_000_000n, capBps: 2500n, weights: EX },
    })),
    ...modes.map((mode) => ({
      name: `${mode} lone winner`,
      description: '',
      inputs: { mode, pool: 4_000_000_000n, capBps: 2500n, weights: [{ key: 'solo', weight: 7n }] },
    })),
    ...modes.map((mode) => ({
      name: `${mode} two equal`,
      description: '',
      inputs: {
        mode,
        pool: 4_000_000_000n,
        capBps: 2500n,
        weights: [
          { key: 'a', weight: 1n },
          { key: 'b', weight: 1n },
        ],
      },
    })),
    ...modes.map((mode) => ({
      name: `${mode} whale 90 + 5 + 5`,
      description: '',
      inputs: {
        mode,
        pool: 4_000_000_000n,
        capBps: 2500n,
        weights: [
          { key: 'whale', weight: 90n },
          { key: 'x', weight: 5n },
          { key: 'y', weight: 5n },
        ],
      },
    })),
    {
      name: 'WaterFill cascade 60/30/5/5',
      description: '',
      inputs: {
        mode: 'WaterFill',
        pool: 4_000_000_000n,
        capBps: 2500n,
        weights: [
          { key: 'w', weight: 60n },
          { key: 'b', weight: 30n },
          { key: 'c', weight: 5n },
          { key: 'd', weight: 5n },
        ],
      },
    },
    {
      name: 'HardCap zero weight and dust',
      description: 'pool 7, weights 3/0/4',
      inputs: {
        mode: 'HardCap',
        pool: 7n,
        capBps: 10_000n,
        weights: [
          { key: 'a', weight: 3n },
          { key: 'z', weight: 0n },
          { key: 'b', weight: 4n },
        ],
      },
    },
    {
      name: 'Proportional u128-scale weights',
      description: '',
      inputs: {
        mode: 'Proportional',
        pool: 123_456_789_012n,
        capBps: 10_000n,
        weights: [
          { key: 'a', weight: 10n ** 30n },
          { key: 'b', weight: 3n * 10n ** 29n },
        ],
      },
    },
    {
      name: 'empty winners',
      description: '',
      inputs: { mode: 'HardCap', pool: 1_000n, capBps: 2500n, weights: [] },
    },
  ],
  run(i) {
    const r = distribute(i.mode, i.pool, i.weights, i.capBps);
    return {
      payouts: Object.fromEntries(r.payouts),
      distributed: r.distributed,
      remainder: r.remainder,
      effectiveCapBps: r.effectiveCapBps,
    };
  },
  decode(j) {
    const o = obj(j);
    return {
      mode: str(o.mode) as DistributionMode,
      pool: big(o.pool),
      capBps: big(o.capBps),
      weights: arr(o.weights).map((x) => {
        const w = obj(x);
        return { key: str(w.key), weight: big(w.weight) };
      }),
    };
  },
};

// ─────────────────────────────────────────────────────────────── upset

interface UpsetCase {
  winnerTwabShareBps: bigint;
  basePool: bigint;
  reserveBalance: bigint;
  reserveDrawBps: number;
  upsetBonusCapUsdc: bigint;
  underdog: UnderdogPolicy;
}
const up = (o: Partial<UpsetCase>): UpsetCase => ({
  winnerTwabShareBps: 2000n,
  basePool: 4_000_000_000n,
  reserveBalance: 1_000_000_000_000n,
  reserveDrawBps: DEFAULT_PROTOCOL_LIMITS.reserveDrawBps,
  upsetBonusCapUsdc: DEFAULT_PROTOCOL_LIMITS.upsetBonusCapUsdc,
  underdog: UD,
  ...o,
});
export const upsetCategory: Category<UpsetCase> = {
  category: 'upset',
  cases: [
    { name: 'favourite wins', description: '', inputs: up({ winnerTwabShareBps: 7000n }) },
    { name: 'exactly 50%', description: '', inputs: up({ winnerTwabShareBps: 5000n }) },
    { name: '20% underdog deep reserve', description: '+60%', inputs: up({}) },
    {
      name: 'reserve draw limit',
      description: '10% of 10 000 USDC',
      inputs: up({ reserveBalance: 10_000_000_000n }),
    },
    {
      name: 'absolute cap',
      description: '',
      inputs: up({
        winnerTwabShareBps: 1000n,
        basePool: 100_000_000_000n,
        reserveBalance: 10n ** 13n,
      }),
    },
    {
      name: 'reserve balance below draw',
      description: 'draw 100%, balance 5',
      inputs: up({ reserveBalance: 5n, reserveDrawBps: 10_000 }),
    },
    { name: 'empty reserve', description: '', inputs: up({ reserveBalance: 0n }) },
    { name: 'zero pool', description: '', inputs: up({ basePool: 0n }) },
  ],
  run(i) {
    return computeUpsetBonus({
      winnerTwabShareBps: i.winnerTwabShareBps,
      basePool: i.basePool,
      reserveBalance: i.reserveBalance,
      policy: {
        underdog: i.underdog,
        reserveDrawBps: i.reserveDrawBps,
        upsetBonusCapUsdc: i.upsetBonusCapUsdc,
      },
    });
  },
  decode(j) {
    const o = obj(j);
    return {
      winnerTwabShareBps: big(o.winnerTwabShareBps),
      basePool: big(o.basePool),
      reserveBalance: big(o.reserveBalance),
      reserveDrawBps: num(o.reserveDrawBps),
      upsetBonusCapUsdc: big(o.upsetBonusCapUsdc),
      underdog: decodeUnderdogPolicy(o.underdog),
    };
  },
};

// ─────────────────────────────────────────────────────────────── arena scenarios

interface ArenaCase {
  config: ArenaConfig;
  createdAt: bigint;
  rolloverIn: bigint;
  events: ArenaEvent[];
  /** Claims/observations after the stream, computed for every position. */
  claimAt: bigint;
}

function cfg(o: Partial<ArenaConfig> & { durationSecs?: bigint } = {}): ArenaConfig {
  const startTs = o.startTs ?? T0 + HOUR;
  const { durationSecs, ...rest } = o;
  return {
    creator: 'creator',
    authority: 'authority',
    assets: { A: BONK, B: TSLAX },
    startTs,
    endTs: startTs + (durationSecs ?? DAY),
    params: DEFAULT_ARENA_PARAMS,
    feePolicy: DEFAULT_FEE_POLICY,
    limits: DEFAULT_PROTOCOL_LIMITS,
    sponsorOpen: true,
    distributionMode: 'HardCap',
    allowClosedSettlement: false,
    underdogSettlementClamp: false,
    ...rest,
  };
}

function feeAtStart(units: bigint, side: SideId): bigint {
  const p = side === 'A' ? 281n : TSLA_PRICE_Q8;
  const d = side === 'A' ? 5 : 8;
  return feeRequired(notionalUsdc(units, p, d), DEFAULT_FEE_POLICY.feeBps);
}

function backEv(
  now: bigint,
  owner: string,
  side: SideId,
  usd: bigint,
  feeOverride?: bigint,
): ArenaEvent {
  const units = side === 'A' ? bonk(usd) : tsla(usd);
  return { type: 'back', now, owner, side, units, feePaid: feeOverride ?? feeAtStart(units, side) };
}

const C0 = cfg();
const START = C0.startTs;
const END = C0.endTs;
const startEv = (c: ArenaConfig = C0, a = 281n, b = TSLA_PRICE_Q8): ArenaEvent => ({
  type: 'snapshotStart',
  now: c.startTs,
  prices: { A: price(c.assets.A, a, c.startTs), B: price(c.assets.B, b, c.startTs) },
});
const settleEv = (
  c: ArenaConfig,
  a: bigint,
  b: bigint,
  now = c.endTs,
  reserve = 0n,
): ArenaEvent => ({
  type: 'settle',
  now,
  reserveBalance: reserve,
  prices: { A: price(c.assets.A, a, c.endTs), B: price(c.assets.B, b, c.endTs) },
});

const CLAMP = cfg({ underdogSettlementClamp: true, durationSecs: 30n * DAY });
const SHORT = cfg({ durationSecs: HOUR });
const WF = cfg({ distributionMode: 'WaterFill' });

export const arenaCategory: Category<ArenaCase> = {
  category: 'arena',
  cases: [
    {
      name: 'happy path BONK wins',
      description: 'four backers, one late, one partial exit; BONK +6.76% vs TSLAx +2.17%',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(),
          backEv(START, 'alice', 'A', 1000n),
          backEv(START, 'carol', 'B', 5000n),
          backEv(START + 6n * HOUR, 'bob', 'A', 1000n),
          { type: 'exit', now: START + 12n * HOUR, owner: 'alice', side: 'A', units: bonk(500n) },
          backEv(START + 20n * HOUR, 'dave', 'A', 250n),
          settleEv(C0, 300n, 37_317_592_500n),
        ],
        claimAt: END + HOUR,
      },
    },
    {
      name: 'tie with sponsor refund and sweep',
      description: 'equal returns; sponsor refundable; unclaimed sweep excludes sponsor money',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(),
          { type: 'fundPool', now: START + 1n, sponsor: 'sponsor', amount: 25_000_000_000n },
          backEv(START + 2n, 'alice', 'A', 1000n),
          backEv(START + 2n, 'bob', 'B', 1000n),
          settleEv(C0, 281n, TSLA_PRICE_Q8),
          {
            type: 'sweepUnclaimed',
            now: END + BigInt(DEFAULT_PROTOCOL_LIMITS.claimWindowSecs) + 1n,
          },
          {
            type: 'refundSponsor',
            now: END + BigInt(DEFAULT_PROTOCOL_LIMITS.claimWindowSecs) + 2n,
            sponsor: 'sponsor',
          },
        ],
        claimAt: END + HOUR,
      },
    },
    {
      name: 'guards: rejected events leave state unchanged',
      description:
        'early start, backing before live, fee too low, below minimum, post-cutoff, early settle, duplicate settle, losing claim, double claim',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          {
            type: 'snapshotStart',
            now: START - 1n,
            prices: { A: price(BONK, 281n, START), B: price(TSLAX, TSLA_PRICE_Q8, START) },
          },
          backEv(START, 'x', 'A', 100n),
          startEv(),
          backEv(START + 1n, 'x', 'A', 100n, 0n),
          { type: 'back', now: START + 1n, owner: 'x', side: 'A', units: 1n, feePaid: 0n },
          backEv(START + 1n, 'x', 'A', 100n),
          backEv(START + 2n, 'y', 'B', 100n),
          backEv(END - 8640n, 'late', 'A', 100n),
          settleEv(C0, 300n, TSLA_PRICE_Q8, END - 1n),
          settleEv(C0, 300n, TSLA_PRICE_Q8),
          settleEv(C0, 300n, TSLA_PRICE_Q8),
          { type: 'claim', now: END + 1n, owner: 'y', side: 'B' },
          { type: 'claim', now: END + 1n, owner: 'x', side: 'A' },
          { type: 'claim', now: END + 2n, owner: 'x', side: 'A' },
        ],
        claimAt: END + HOUR,
      },
    },
    {
      name: 'cancel expired after settlement window',
      description:
        'no settlement within grace → permissionless cancel; positions withdrawable; sponsor refundable',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(),
          { type: 'fundPool', now: START + 1n, sponsor: 'sponsor', amount: 1_000_000_000n },
          backEv(START + 2n, 'alice', 'A', 500n),
          { type: 'cancelExpired', now: END + 6n * HOUR },
          { type: 'cancelExpired', now: END + 6n * HOUR + 1n },
          { type: 'exit', now: END + 6n * HOUR + 2n, owner: 'alice', side: 'A', units: bonk(500n) },
          { type: 'refundSponsor', now: END + 6n * HOUR + 3n, sponsor: 'sponsor' },
        ],
        claimAt: END + 7n * HOUR,
      },
    },
    {
      name: 'authority cancel and extension flow',
      description: 'extend once, second extension rejected, authority cancels with reason',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(),
          backEv(START, 'alice', 'A', 500n),
          { type: 'extendSettlement', now: END, actor: 'authority', secs: DAY, reason: 'holiday' },
          { type: 'extendSettlement', now: END, actor: 'authority', secs: HOUR, reason: 'again' },
          { type: 'cancel', now: END + DAY, actor: 'creator', reason: 'not allowed' },
          { type: 'cancel', now: END + DAY, actor: 'authority', reason: 'oracle outage' },
        ],
        claimAt: END + 2n * DAY,
      },
    },
    {
      name: 'underdog upset with bonus and settlement clamp',
      description:
        '30-day arena; attacker inflates A for a day then backs B; B wins as underdog; clamp on',
      inputs: {
        config: CLAMP,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(CLAMP),
          backEv(CLAMP.startTs, 'honestA', 'A', 10_000n),
          backEv(CLAMP.startTs, 'honestB', 'B', 10_000n),
          backEv(CLAMP.startTs + 10n * DAY, 'attacker', 'A', 100_000n),
          backEv(CLAMP.startTs + 11n * DAY, 'attacker', 'B', 10_000n),
          {
            type: 'exit',
            now: CLAMP.startTs + 11n * DAY + 1n,
            owner: 'attacker',
            side: 'A',
            units: bonk(100_000n),
          },
          settleEv(CLAMP, 281n, TSLA_PRICE_Q8 + 1_000_000_000n, CLAMP.endTs, 100_000_000_000n),
        ],
        claimAt: CLAMP.endTs + HOUR,
      },
    },
    {
      name: 'short arena with min-hold floor',
      description: '1 h arena: backing closes at 45 min; warm-up 30 min',
      inputs: {
        config: SHORT,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(SHORT),
          backEv(SHORT.startTs, 'a', 'A', 8000n),
          backEv(SHORT.startTs + 15n * 60n, 'b', 'B', 2000n),
          backEv(SHORT.startTs + 45n * 60n, 'late', 'B', 2000n),
          settleEv(SHORT, 281n, TSLA_PRICE_Q8 + 10n ** 9n),
        ],
        claimAt: SHORT.endTs + HOUR,
      },
    },
    {
      name: 'water-fill distribution with rollover in',
      description:
        'rollover of 1 000 USDC seeds the pool; whale is capped and excess redistributed',
      inputs: {
        config: WF,
        createdAt: T0,
        rolloverIn: 1_000_000_000n,
        events: [
          startEv(WF),
          backEv(START, 'whale', 'A', 70_000n),
          backEv(START, 'x', 'A', 10_000n),
          backEv(START, 'y', 'A', 10_000n),
          backEv(START, 'z', 'A', 10_000n),
          backEv(START, 'b', 'B', 1000n),
          settleEv(WF, 300n, TSLA_PRICE_Q8),
        ],
        claimAt: END + HOUR,
      },
    },
    {
      name: 'scaled multiplier split mid-arena',
      description: 'TSLAx 4:1 split at settlement: price/4 × multiplier 4 → flat; BONK -1% loses',
      inputs: {
        config: C0,
        createdAt: T0,
        rolloverIn: 0n,
        events: [
          startEv(),
          backEv(START, 'a', 'A', 100n),
          backEv(START, 'b', 'B', 100n),
          {
            type: 'settle',
            now: END,
            reserveBalance: 0n,
            prices: {
              A: price(BONK, 278n, END),
              B: price(TSLAX, 9_131_250_000n, END, { multQ6: 4_000_000n }),
            },
          },
        ],
        claimAt: END + HOUR,
      },
    },
  ],
  run(i) {
    let state = createArena(i.config, i.createdAt, i.rolloverIn).state;
    const trace: unknown[] = [];
    i.events.forEach((e, index) => {
      try {
        const r = applyEvent(state, e);
        state = r.state;
        trace.push({ index, type: e.type, ok: true, effects: r.effects });
      } catch (err) {
        if (!isTribeError(err)) throw err;
        trace.push({ index, type: e.type, ok: false, error: err.code });
      }
    });
    const positions: Record<string, unknown> = {};
    for (const [key, p] of Object.entries(state.positions)) {
      let rewardWeight: bigint | null = null;
      let payout: bigint | string | null = null;
      if (state.status === 'Settled' && state.settlement && state.settlement.winner === p.side) {
        rewardWeight = positionRewardWeight(state, p);
        try {
          const r = applyEvent(state, {
            type: 'claim',
            now: i.claimAt,
            owner: p.owner,
            side: p.side,
          });
          const eff = r.effects[0];
          payout = eff?.kind === 'RewardClaimed' ? eff.amount : null;
        } catch (err) {
          payout = isTribeError(err) ? err.code : null;
        }
      }
      positions[key] = {
        units: p.units,
        unitSeconds: p.unitSeconds,
        effUnits: p.effUnits,
        effUnitSeconds: p.effUnitSeconds,
        claimed: p.claimed,
        forfeited: p.forfeited,
        feePaid: p.feePaid,
        rewardWeight,
        payout,
      };
    }
    return {
      status: state.status,
      phaseAtClaim: phaseOf(state, i.claimAt),
      backingCloseTs: state.backingCloseTs,
      startPrices: state.startPrices,
      endPrices: state.endPrices,
      settlement: state.settlement ?? null,
      cancelReason: state.cancelReason ?? null,
      rewardVault: state.rewardVault,
      protocolFees: state.protocolFees,
      creatorFees: state.creatorFees,
      sponsorTotal: state.sponsorTotal,
      rolloverIn: state.rolloverIn,
      rolloverOut: state.rolloverOut,
      totalClaimed: state.totalClaimed,
      sides: state.sides,
      positions,
      trace,
    };
  },
  decode(j) {
    const o = obj(j);
    const c = obj(o.config);
    const assets = obj(c.assets);
    const params = obj(c.params);
    const limits = obj(c.limits);
    const config: ArenaConfig = {
      creator: str(c.creator),
      authority: str(c.authority),
      assets: { A: decodeAsset(assets.A), B: decodeAsset(assets.B) },
      startTs: big(c.startTs),
      endTs: big(c.endTs),
      params: {
        tieBps: num(params.tieBps),
        minHoldBps: num(params.minHoldBps),
        minHoldFloorSecs: num(params.minHoldFloorSecs),
        underdog: decodeUnderdogPolicy(params.underdog),
        maxShareBps: num(params.maxShareBps),
        settlementGraceSecs: num(params.settlementGraceSecs),
        minBackingUsdc: big(params.minBackingUsdc),
      },
      feePolicy: decodeFeePolicy(c.feePolicy),
      limits: {
        minDurationSecs: num(limits.minDurationSecs),
        maxDurationSecs: num(limits.maxDurationSecs),
        minLeadSecs: num(limits.minLeadSecs),
        claimWindowSecs: num(limits.claimWindowSecs),
        rolloverExpirySecs: num(limits.rolloverExpirySecs),
        maxExtensionSecs: num(limits.maxExtensionSecs),
        reserveDrawBps: num(limits.reserveDrawBps),
        upsetBonusCapUsdc: big(limits.upsetBonusCapUsdc),
      },
      sponsorOpen: bool(c.sponsorOpen),
      distributionMode: str(c.distributionMode) as DistributionMode,
      allowClosedSettlement: bool(c.allowClosedSettlement),
      underdogSettlementClamp: bool(c.underdogSettlementClamp),
    };
    const events = arr(o.events).map((x): ArenaEvent => {
      const e = obj(x);
      const type = str(e.type);
      const now = big(e.now);
      switch (type) {
        case 'fundPool':
          return { type, now, sponsor: str(e.sponsor), amount: big(e.amount) };
        case 'snapshotStart': {
          const p = obj(e.prices);
          return { type, now, prices: { A: decodePriceInput(p.A), B: decodePriceInput(p.B) } };
        }
        case 'back':
          return {
            type,
            now,
            owner: str(e.owner),
            side: str(e.side) as SideId,
            units: big(e.units),
            feePaid: big(e.feePaid),
          };
        case 'exit':
          return {
            type,
            now,
            owner: str(e.owner),
            side: str(e.side) as SideId,
            units: big(e.units),
          };
        case 'settle': {
          const p = obj(e.prices);
          return {
            type,
            now,
            reserveBalance: big(e.reserveBalance),
            prices: { A: decodePriceInput(p.A), B: decodePriceInput(p.B) },
          };
        }
        case 'claim':
          return { type, now, owner: str(e.owner), side: str(e.side) as SideId };
        case 'cancel':
          return { type, now, actor: str(e.actor), reason: str(e.reason) };
        case 'cancelExpired':
          return { type, now };
        case 'extendSettlement':
          return { type, now, actor: str(e.actor), secs: big(e.secs), reason: str(e.reason) };
        case 'refundSponsor':
          return { type, now, sponsor: str(e.sponsor) };
        case 'sweepUnclaimed':
          return { type, now };
        default:
          throw new Error(`unknown event ${type}`);
      }
    });
    return {
      config,
      createdAt: big(o.createdAt),
      rolloverIn: big(o.rolloverIn),
      events,
      claimAt: big(o.claimAt),
    };
  },
};

export const ALL_CATEGORIES: Category<unknown>[] = [
  mathCategory,
  accrualCategory,
  underdogCategory,
  feesCategory,
  oracleCategory,
  settlementCategory,
  distributionCategory,
  upsetCategory,
  arenaCategory,
] as Category<unknown>[];

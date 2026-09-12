import { describe, expect, it } from 'vitest';

import { DEFAULT_PROTOCOL_LIMITS } from '../config/policy';
import {
  AUTHORITY,
  BONK,
  BONK_PRICE_Q8,
  CREATOR,
  DAY,
  HOUR,
  T0,
  TSLA_PRICE_Q8,
  TSLAX,
  arenaConfig,
  harness,
  priceInput,
  unitsForUsd,
} from '../testing/fixtures';
import { accruePosition } from './accrual';
import { applyEvent, createArena, finalWinningWeights, phaseOf, type ArenaEvent } from './arena';
import { ErrorCode, TribeError } from './errors';

function expectCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TribeError);
    expect((e as TribeError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe('createArena', () => {
  it('derives backing close and starts SCHEDULED', () => {
    const cfg = arenaConfig();
    const { state } = createArena(cfg, T0);
    expect(state.status).toBe('Scheduled');
    // 24 h Arena → min hold = max(2.4 h, 15 min) = 2.4 h
    expect(state.backingCloseTs).toBe(cfg.endTs - 8640n);
    expect(phaseOf(state, T0)).toBe('SCHEDULED');
  });
  it('rejects same asset, bad duration, insufficient lead time', () => {
    expectCode(
      () => createArena(arenaConfig({ assets: { A: BONK, B: BONK } }), T0),
      ErrorCode.SameAsset,
    );
    expectCode(
      () => createArena(arenaConfig({ durationSecs: 10n * 60n }), T0),
      ErrorCode.InvalidParams,
    );
    expectCode(
      () => createArena(arenaConfig({ durationSecs: 31n * DAY }), T0),
      ErrorCode.InvalidParams,
    );
    expectCode(() => createArena(arenaConfig({ startTs: T0 + 60n }), T0), ErrorCode.TooLate);
  });
  it('rejects an invalid fee split via schema', () => {
    const cfg = arenaConfig();
    cfg.feePolicy = {
      ...cfg.feePolicy,
      split: { rewardPoolBps: 5000, protocolBps: 5000, creatorBps: 1000 },
    };
    expect(() => createArena(cfg, T0)).toThrow();
  });
  it('accepts rollover into the vault', () => {
    const { state } = createArena(arenaConfig(), T0, 1_000_000n);
    expect(state.rewardVault).toBe(1_000_000n);
    expect(state.rolloverIn).toBe(1_000_000n);
  });
});

describe('snapshotStart', () => {
  it('rejects early start, late start, bad oracle', () => {
    const h = harness();
    const c = h.state.config;
    const good = {
      A: priceInput(BONK, BONK_PRICE_Q8, c.startTs),
      B: priceInput(TSLAX, TSLA_PRICE_Q8, c.startTs),
    };
    expectCode(
      () => h.apply({ type: 'snapshotStart', now: c.startTs - 1n, prices: good }),
      ErrorCode.TooEarly,
    );
    expectCode(
      () => h.apply({ type: 'snapshotStart', now: c.startTs + 6n * HOUR + 1n, prices: good }),
      ErrorCode.TooLate,
    );
    expectCode(
      () =>
        h.apply({
          type: 'snapshotStart',
          now: c.startTs,
          prices: { ...good, B: priceInput(TSLAX, TSLA_PRICE_Q8, c.startTs - 3n * HOUR) },
        }),
      ErrorCode.OracleStale,
    );
    expectCode(
      () =>
        h.apply({
          type: 'snapshotStart',
          now: c.startTs,
          prices: { ...good, A: { ...good.A, verificationLevel: 'Partial' } },
        }),
      ErrorCode.OracleNotFullyVerified,
    );
    h.start();
    expect(h.state.status).toBe('Live');
    expectCode(
      () => h.apply({ type: 'snapshotStart', now: c.startTs, prices: good }),
      ErrorCode.InvalidStatus,
    );
  });
  it('applies the ScaledUi multiplier to the equity side', () => {
    const h = harness();
    const c = h.state.config;
    h.apply({
      type: 'snapshotStart',
      now: c.startTs,
      prices: {
        A: priceInput(BONK, BONK_PRICE_Q8, c.startTs),
        B: priceInput(TSLAX, TSLA_PRICE_Q8, c.startTs, { multQ6: 1_008_000n }),
      },
    });
    expect(h.state.startPrices.B?.priceQ8).toBe((TSLA_PRICE_Q8 * 1_008_000n) / 1_000_000n);
    expect(h.state.startPrices.A?.multQ6).toBe(1_000_000n);
  });
  it('permissionless cancel_expired after the start grace', () => {
    const h = harness();
    const c = h.state.config;
    expectCode(
      () => h.apply({ type: 'cancelExpired', now: c.startTs + 6n * HOUR }),
      ErrorCode.NotExpired,
    );
    h.apply({ type: 'cancelExpired', now: c.startTs + 6n * HOUR + 1n });
    expect(h.state.status).toBe('Cancelled');
    expect(phaseOf(h.state, c.startTs)).toBe('CANCELLED');
  });
});

describe('back', () => {
  it('requires LIVE, a minimum notional and the exact fee', () => {
    const h = harness();
    const c = h.state.config;
    expectCode(() => h.back('u1', 'A', 1_000_000n, c.startTs, 0n), ErrorCode.InvalidStatus);
    h.start();
    // 1 BONK unit is far below 5 USDC
    expectCode(() => h.back('u1', 'A', 1n, c.startTs + 1n, 0n), ErrorCode.BelowMinimumBacking);
    const units = unitsForUsd(h.state, 'A', 100n); // $100 of BONK
    expectCode(() => h.back('u1', 'A', units, c.startTs + 1n, 0n), ErrorCode.FeeTooLow);
    const r = h.back('u1', 'A', units, c.startTs + 1n);
    const eff = r.effects[0];
    expect(eff?.kind).toBe('Backed');
    if (eff?.kind === 'Backed') {
      expect(eff.notionalUsdc).toBe(99_999_999n); // floor of $100 worth of BONK at 281e-8
      expect(eff.feeRequired).toBe(499_999n); // 0.50 %
      expect(eff.toPool + eff.toProtocol + eff.toCreator).toBe(eff.feePaid);
      expect(eff.multiplierQ4).toBe(10_000n); // first backer: share 100 % → 1.0×
    }
    expect(h.state.sides.A.participants).toBe(1n);
    expect(h.state.rewardVault).toBe(199_999n);
    expect(h.state.creatorFees).toBe(99_999n);
    expect(h.state.protocolFees).toBe(200_001n); // absorbs rounding
  });
  it('rejects backing at and after the cutoff (LOCKED) and after end', () => {
    const h = harness();
    h.start();
    const units = unitsForUsd(h.state, 'A', 50n);
    const close = h.state.backingCloseTs;
    h.back('u1', 'A', units, close - 1n);
    expect(phaseOf(h.state, close - 1n)).toBe('LIVE');
    expectCode(() => h.back('u2', 'A', units, close), ErrorCode.BackingClosed);
    expect(phaseOf(h.state, close)).toBe('LOCKED');
    expectCode(() => h.back('u2', 'A', units, h.state.config.endTs + 1n), ErrorCode.BackingClosed);
    expect(phaseOf(h.state, h.state.config.endTs)).toBe('ENDING');
  });
  it('rejects non-monotonic clocks', () => {
    const h = harness();
    h.start();
    const units = unitsForUsd(h.state, 'A', 50n);
    h.back('u1', 'A', units, h.state.config.startTs + 100n);
    expectCode(
      () => h.back('u2', 'A', units, h.state.config.startTs + 99n),
      ErrorCode.NonMonotonicClock,
    );
  });
  it('allows the same wallet on both sides as separate positions', () => {
    const h = harness();
    h.start();
    h.back('u1', 'A', unitsForUsd(h.state, 'A', 50n), h.state.config.startTs + 1n);
    h.back('u1', 'B', unitsForUsd(h.state, 'B', 50n), h.state.config.startTs + 2n);
    expect(Object.keys(h.state.positions).sort()).toEqual(['A:u1', 'B:u1']);
  });
});

describe('exit', () => {
  it('full exit before end forfeits; partial exit is proportional; after end weight is kept', () => {
    const h = harness();
    h.start();
    const c = h.state.config;
    const uA = unitsForUsd(h.state, 'A', 100n);
    h.back('u1', 'A', uA, c.startTs);
    h.back('u2', 'A', uA, c.startTs);
    // u1 partial exit at +12h: keeps half of accrued and live weight
    h.exit('u1', 'A', uA / 2n, c.startTs + 12n * HOUR);
    const p1 = h.state.positions['A:u1'];
    const p2 = h.state.positions['A:u2'];
    expect(p1?.units).toBe(uA - uA / 2n);
    // u2 full exit at +23h → forfeited
    h.exit('u2', 'A', uA, c.startTs + 23n * HOUR);
    expect(h.state.positions['A:u2']?.effUnitSeconds).toBe(0n);
    expect(h.state.positions['A:u2']?.forfeited).toBe(true);
    expect(p2?.claimed).toBe(false);
    // u1 withdraws the rest after end: weight is the end_ts-accrued value, unchanged by the exit
    const p1Before = h.state.positions['A:u1'];
    if (!p1Before) throw new Error('missing');
    const finalWeight = accruePosition(p1Before, c.endTs, {
      startTs: c.startTs,
      endTs: c.endTs,
    }).effUnitSeconds;
    h.exit('u1', 'A', uA - uA / 2n, c.endTs + 10n);
    expect(h.state.positions['A:u1']?.effUnitSeconds).toBe(finalWeight);
    expect(h.state.positions['A:u1']?.forfeited).toBe(false);
  });
  it('rejects unknown positions and over-withdrawal', () => {
    const h = harness();
    h.start();
    expectCode(
      () => h.exit('ghost', 'A', 1n, h.state.config.startTs + 1n),
      ErrorCode.PositionNotFound,
    );
    const u = unitsForUsd(h.state, 'A', 50n);
    h.back('u1', 'A', u, h.state.config.startTs + 1n);
    expectCode(
      () => h.exit('u1', 'A', u + 1n, h.state.config.startTs + 2n),
      ErrorCode.InsufficientUnits,
    );
  });
});

describe('settle', () => {
  function liveArena() {
    const h = harness();
    h.start();
    const c = h.state.config;
    h.back('alice', 'A', unitsForUsd(h.state, 'A', 1000n), c.startTs);
    h.back('bob', 'B', unitsForUsd(h.state, 'B', 1000n), c.startTs);
    return h;
  }
  it('rejects settlement before end, after the window, twice, and with stale oracle', () => {
    const h = liveArena();
    const c = h.state.config;
    expectCode(
      () => h.settle({ A: BONK_PRICE_Q8, B: TSLA_PRICE_Q8 }, c.endTs - 1n),
      ErrorCode.TooEarly,
    );
    expectCode(
      () =>
        h.apply({
          type: 'settle',
          now: c.endTs,
          reserveBalance: 0n,
          prices: {
            A: priceInput(BONK, BONK_PRICE_Q8, c.endTs - 61n),
            B: priceInput(TSLAX, TSLA_PRICE_Q8, c.endTs),
          },
        }),
      ErrorCode.OracleStale,
    );
    expectCode(
      () => h.settle({ A: BONK_PRICE_Q8, B: TSLA_PRICE_Q8 }, c.endTs + 6n * HOUR + 1n),
      ErrorCode.TooLate,
    );
    h.settle({ A: 300n, B: TSLA_PRICE_Q8 }); // BONK +6.76 %
    expect(h.state.settlement?.winner).toBe('A');
    expectCode(() => h.settle({ A: 300n, B: TSLA_PRICE_Q8 }), ErrorCode.AlreadySettled);
  });
  it('a late crank settles with the same price and the same frozen weights', () => {
    const h1 = liveArena();
    const h2 = liveArena();
    h1.settle({ A: 300n, B: TSLA_PRICE_Q8 }, h1.state.config.endTs);
    h2.settle({ A: 300n, B: TSLA_PRICE_Q8 }, h2.state.config.endTs + 5n * HOUR);
    expect(h2.state.settlement?.wTotal).toBe(h1.state.settlement?.wTotal);
    expect(h2.state.settlement?.poolAtSettlement).toBe(h1.state.settlement?.poolAtSettlement);
    expect(h2.state.sides.A.effUnitSeconds).toBe(h1.state.sides.A.effUnitSeconds);
  });
  it('TIE inside the band; sponsors refundable; unclaimed sweep respects refunds', () => {
    const h = liveArena();
    const c = h.state.config;
    h.apply({ type: 'fundPool', now: c.startTs + 1n, sponsor: 'sponsor', amount: 25_000_000_000n });
    expectCode(
      () => h.apply({ type: 'refundSponsor', now: c.startTs + 2n, sponsor: 'sponsor' }),
      ErrorCode.RefundNotAvailable,
    );
    h.settle({ A: BONK_PRICE_Q8, B: TSLA_PRICE_Q8 });
    expect(h.state.settlement?.winner).toBe('TIE');
    expectCode(() => h.claim('alice', 'A'), ErrorCode.NoWinner);
    const vaultBefore = h.state.rewardVault;
    h.apply({
      type: 'sweepUnclaimed',
      now: c.endTs + BigInt(DEFAULT_PROTOCOL_LIMITS.claimWindowSecs) + 1n,
    });
    expect(h.state.rewardVault).toBe(25_000_000_000n); // only sponsor money remains
    expect(h.state.rolloverOut).toBe(vaultBefore - 25_000_000_000n);
    h.apply({ type: 'refundSponsor', now: c.endTs + DAY, sponsor: 'sponsor' });
    expect(h.state.rewardVault).toBe(0n);
    expectCode(
      () => h.apply({ type: 'refundSponsor', now: c.endTs + DAY, sponsor: 'sponsor' }),
      ErrorCode.SponsorAlreadyRefunded,
    );
  });
  it('extend once, then cancel_expired after the extended deadline', () => {
    const h = liveArena();
    const c = h.state.config;
    expectCode(
      () =>
        h.apply({
          type: 'extendSettlement',
          now: c.endTs,
          actor: CREATOR,
          secs: HOUR,
          reason: 'x',
        }),
      ErrorCode.Unauthorized,
    );
    expectCode(
      () =>
        h.apply({
          type: 'extendSettlement',
          now: c.endTs - 1n,
          actor: AUTHORITY,
          secs: HOUR,
          reason: 'x',
        }),
      ErrorCode.TooEarly,
    );
    h.apply({
      type: 'extendSettlement',
      now: c.endTs,
      actor: AUTHORITY,
      secs: DAY,
      reason: 'holiday',
    });
    expectCode(
      () =>
        h.apply({
          type: 'extendSettlement',
          now: c.endTs,
          actor: AUTHORITY,
          secs: HOUR,
          reason: 'x',
        }),
      ErrorCode.AlreadyExtended,
    );
    const deadline = c.endTs + 6n * HOUR + DAY;
    expectCode(() => h.apply({ type: 'cancelExpired', now: deadline }), ErrorCode.NotExpired);
    h.apply({ type: 'cancelExpired', now: deadline + 1n });
    expect(h.state.status).toBe('Cancelled');
    // positions remain withdrawable after cancellation
    const u = h.state.positions['A:alice']?.units ?? 0n;
    h.exit('alice', 'A', u, deadline + 2n);
    expect(h.state.positions['A:alice']?.units).toBe(0n);
  });
  it('authority cancel; creator cannot', () => {
    const h = liveArena();
    const c = h.state.config;
    expectCode(
      () => h.apply({ type: 'cancel', now: c.startTs + 1n, actor: CREATOR, reason: 'x' }),
      ErrorCode.Unauthorized,
    );
    h.apply({ type: 'cancel', now: c.startTs + 1n, actor: AUTHORITY, reason: 'asset suspended' });
    expect(h.state.status).toBe('Cancelled');
    expectCode(
      () => h.apply({ type: 'cancel', now: c.startTs + 2n, actor: AUTHORITY, reason: 'x' }),
      ErrorCode.InvalidStatus,
    );
  });
});

describe('claim', () => {
  function settledArena() {
    const h = harness();
    h.start();
    const c = h.state.config;
    h.back('alice', 'A', unitsForUsd(h.state, 'A', 1000n), c.startTs);
    h.back('carol', 'B', unitsForUsd(h.state, 'B', 5000n), c.startTs);
    h.back('dave', 'A', unitsForUsd(h.state, 'A', 1000n), c.startTs);
    h.back('bob', 'A', unitsForUsd(h.state, 'A', 1000n), c.startTs + 12n * HOUR);
    h.exit('dave', 'A', h.state.positions['A:dave']?.units ?? 0n, c.startTs + 20n * HOUR);
    h.settle({ A: 300n, B: TSLA_PRICE_Q8 });
    return h;
  }
  it('pays proportionally by time-weighted weight; guards losers, duplicates, forfeits', () => {
    const h = settledArena();
    const pool = h.state.settlement?.poolAtSettlement ?? 0n;
    expect(pool).toBeGreaterThan(0n);
    expectCode(() => h.claim('carol', 'B'), ErrorCode.NotWinningSide);
    expectCode(() => h.claim('dave', 'A'), ErrorCode.NoRewardWeight);
    expectCode(() => h.claim('nobody', 'A'), ErrorCode.PositionNotFound);
    const a = h.claim('alice', 'A').effects[0];
    const b = h.claim('bob', 'A').effects[0];
    if (a?.kind !== 'RewardClaimed' || b?.kind !== 'RewardClaimed') throw new Error('bad effects');
    // Normative proportional payout: floor(pool × W_i / W_total) with the settlement clamp.
    // alice: 24 h at 1.0×; bob: 12 h at 1.25× (A was the 37.5 % side when he entered);
    // m_settle ≈ 1.36× (A's whole-Arena share ≈ 32 %) so neither tranche is clamped.
    const st = h.state.settlement;
    if (!st) throw new Error('not settled');
    const w = new Map(finalWinningWeights(h.state).map((x) => [x.key, x.weight]));
    expect(a.amount).toBe((pool * (w.get('A:alice') ?? 0n)) / st.wTotal);
    expect(b.amount).toBe((pool * (w.get('A:bob') ?? 0n)) / st.wTotal);
    expect(a.amount).toBeGreaterThan(b.amount);
    expect(a.amount + b.amount).toBeGreaterThan((pool * 99n) / 100n); // no cap → ≤ 1 % dust rolls
    expect(a.amount + b.amount).toBeLessThanOrEqual(pool);
    expectCode(() => h.claim('alice', 'A'), ErrorCode.AlreadyClaimed);
    expect(h.state.totalClaimed).toBe(a.amount + b.amount);
  });
  it('regression: withdrawing after end then claiming works and pays the frozen weight', () => {
    const h = harness();
    h.start();
    const c = h.state.config;
    h.back('alice', 'A', unitsForUsd(h.state, 'A', 100n), c.startTs);
    h.back('bob', 'B', unitsForUsd(h.state, 'B', 100n), c.startTs);
    h.exit('alice', 'A', h.state.positions['A:alice']?.units ?? 0n, c.endTs + 3n * HOUR); // before settle
    h.settle({ A: 300n, B: TSLA_PRICE_Q8 }, c.endTs + 4n * HOUR);
    const r = h.claim('alice', 'A', c.endTs + 5n * HOUR).effects[0];
    if (r?.kind !== 'RewardClaimed') throw new Error('expected claim');
    expect(r.amount).toBe(h.state.settlement?.poolAtSettlement ?? 0n); // lone winner takes the whole pool
    expect(h.state.positions['A:alice']?.units).toBe(0n);
  });
  it('claim before settlement is rejected', () => {
    const h = harness();
    h.start();
    h.back('alice', 'A', unitsForUsd(h.state, 'A', 100n), h.state.config.startTs);
    expectCode(() => h.claim('alice', 'A', h.state.config.endTs), ErrorCode.InvalidStatus);
  });
  it('same event stream always produces the same final state', () => {
    const events: ArenaEvent[] = [];
    const h = harness();
    const c = h.state.config;
    const record = (e: ArenaEvent) => {
      events.push(e);
      h.apply(e);
    };
    record({
      type: 'snapshotStart',
      now: c.startTs,
      prices: {
        A: priceInput(BONK, BONK_PRICE_Q8, c.startTs),
        B: priceInput(TSLAX, TSLA_PRICE_Q8, c.startTs),
      },
    });
    record({
      type: 'back',
      now: c.startTs + 5n,
      owner: 'x',
      side: 'A',
      units: 3_000_000_000_000n,
      feePaid: 500_000n,
    });
    record({
      type: 'back',
      now: c.startTs + 9n,
      owner: 'y',
      side: 'B',
      units: 100_000_000n,
      feePaid: 2_000_000n,
    });
    record({ type: 'exit', now: c.startTs + HOUR, owner: 'x', side: 'A', units: 1n });
    record({
      type: 'settle',
      now: c.endTs + 7n,
      reserveBalance: 10_000_000n,
      prices: { A: priceInput(BONK, 250n, c.endTs), B: priceInput(TSLAX, TSLA_PRICE_Q8, c.endTs) },
    });
    let s2 = createArena(arenaConfig(), T0).state;
    for (const e of events) s2 = applyEvent(s2, e).state;
    expect(JSON.stringify(s2, bigintReplacer)).toBe(JSON.stringify(h.state, bigintReplacer));
  });
});

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

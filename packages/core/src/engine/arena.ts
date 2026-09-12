import { ArenaParamsSchema, FeePolicySchema, ProtocolLimitsSchema } from '../config/policy';
import { assertI64, maxBig, notionalUsdc } from '../math/fixed';
import {
  accrualDelta,
  accruePosition,
  accrueSide,
  applyDeposit,
  applyExit,
  newPosition,
  type Window,
} from './accrual';
import { distribute, payoutHardCap, type WeightedPosition } from './distribution';
import { ErrorCode, fail } from './errors';
import { feeRequired, splitFee } from './fees';
import { validatePriceUpdate, type PriceInput } from './oracle';
import { resolveSettlement } from './settlement';
import { settlementTwabShareBps, type ShareInputs, type SideValuation } from './twab';
import {
  positionKey,
  SIDES,
  ZERO_SIDE,
  type ArenaConfig,
  type ArenaPhase,
  type ArenaState,
  type PositionState,
  type SideId,
  type SidePriceSnapshot,
} from './types';
import { underdogMultiplier } from './underdog';
import { computeUpsetBonus } from './upset';

/**
 * Arena reducer — the reference state machine (ARENA_STATE_MACHINE.md).
 *
 * `applyEvent` is a pure function: same state + same event ⇒ same result.
 * Invalid transitions throw `TribeError` with the code the program will use.
 */

export type ArenaEvent =
  | { type: 'fundPool'; now: bigint; sponsor: string; amount: bigint }
  | { type: 'snapshotStart'; now: bigint; prices: Record<SideId, PriceInput> }
  | {
      type: 'back';
      now: bigint;
      owner: string;
      side: SideId;
      units: bigint;
      feePaid: bigint;
      entryKind?: 'UsdcSwap' | 'ExistingHoldings';
    }
  | { type: 'exit'; now: bigint; owner: string; side: SideId; units: bigint }
  | { type: 'settle'; now: bigint; prices: Record<SideId, PriceInput>; reserveBalance: bigint }
  | { type: 'claim'; now: bigint; owner: string; side: SideId }
  | { type: 'cancel'; now: bigint; actor: string; reason: string }
  | { type: 'cancelExpired'; now: bigint }
  | { type: 'extendSettlement'; now: bigint; actor: string; secs: bigint; reason: string }
  | { type: 'refundSponsor'; now: bigint; sponsor: string }
  | { type: 'sweepUnclaimed'; now: bigint };

export type ArenaEffect =
  | { kind: 'ArenaCreated'; rolloverIn: bigint }
  | { kind: 'PoolFunded'; sponsor: string; amount: bigint }
  | { kind: 'ArenaStarted'; startPrices: Record<SideId, SidePriceSnapshot> }
  | {
      kind: 'Backed';
      owner: string;
      side: SideId;
      units: bigint;
      feePaid: bigint;
      feeRequired: bigint;
      multiplierQ4: bigint;
      notionalUsdc: bigint;
      toPool: bigint;
      toProtocol: bigint;
      toCreator: bigint;
    }
  | { kind: 'Exited'; owner: string; side: SideId; units: bigint; forfeitedWeight: bigint }
  | {
      kind: 'ArenaSettled';
      winner: 'A' | 'B' | 'TIE';
      perfBpsA: bigint;
      perfBpsB: bigint;
      poolAtSettlement: bigint;
      upsetBonus: bigint;
    }
  | { kind: 'RewardClaimed'; owner: string; side: SideId; amount: bigint }
  | { kind: 'ArenaCancelled'; reason: string; expired: boolean }
  | { kind: 'SettlementExtended'; secs: bigint; reason: string }
  | { kind: 'SponsorRefunded'; sponsor: string; amount: bigint }
  | { kind: 'UnclaimedSwept'; amount: bigint };

export interface ApplyResult {
  state: ArenaState;
  effects: ArenaEffect[];
}

// ───────────────────────────────────────────── helpers

function windowOf(s: ArenaState): Window {
  return { startTs: s.config.startTs, endTs: s.config.endTs };
}

function minHoldSecs(c: ArenaConfig): bigint {
  const duration = c.endTs - c.startTs;
  return maxBig(
    (duration * BigInt(c.params.minHoldBps)) / 10_000n,
    BigInt(c.params.minHoldFloorSecs),
  );
}

function requireStatus(s: ArenaState, ...allowed: ArenaState['status'][]): void {
  if (!allowed.includes(s.status)) {
    fail(ErrorCode.InvalidStatus, `status ${s.status}, expected ${allowed.join('|')}`);
  }
}

function settlementDeadline(s: ArenaState): bigint {
  return s.config.endTs + BigInt(s.config.params.settlementGraceSecs) + s.extensionSecs;
}

function valuations(s: ArenaState): Record<SideId, SideValuation> {
  const a = s.startPrices.A;
  const b = s.startPrices.B;
  if (!a || !b) fail(ErrorCode.InvalidStatus, 'start prices not snapshotted');
  return {
    A: { priceQ8: a.priceQ8, decimals: s.config.assets.A.decimals },
    B: { priceQ8: b.priceQ8, decimals: s.config.assets.B.decimals },
  };
}

/** Accrue both side aggregates to `now` (Arena-level clock). */
function accrueArena(s: ArenaState, now: bigint): ArenaState {
  const dt = accrualDelta(s.lastAccrualTs, now, windowOf(s));
  return {
    ...s,
    lastAccrualTs: maxBig(s.lastAccrualTs, now),
    sides: { A: accrueSide(s.sides.A, dt), B: accrueSide(s.sides.B, dt) },
  };
}

function getPosition(s: ArenaState, side: SideId, owner: string): PositionState {
  const p = s.positions[positionKey(side, owner)];
  if (!p) fail(ErrorCode.PositionNotFound, positionKey(side, owner));
  return p;
}

// ───────────────────────────────────────────── phase

export function phaseOf(s: ArenaState, now: bigint): ArenaPhase {
  switch (s.status) {
    case 'Cancelled':
      return 'CANCELLED';
    case 'Settled':
      return 'SETTLED';
    case 'Scheduled':
      return 'SCHEDULED';
    case 'Live':
      if (now >= s.config.endTs) return 'ENDING';
      if (now >= s.backingCloseTs) return 'LOCKED';
      return 'LIVE';
  }
}

// ───────────────────────────────────────────── create

export function createArena(config: ArenaConfig, now: bigint, rolloverIn = 0n): ApplyResult {
  const params = ArenaParamsSchema.parse(config.params);
  const feePolicy = FeePolicySchema.parse(config.feePolicy);
  const limits = ProtocolLimitsSchema.parse(config.limits);
  assertI64(config.startTs, 'start_ts');
  assertI64(config.endTs, 'end_ts');
  if (config.assets.A.mint === config.assets.B.mint) fail(ErrorCode.SameAsset);
  const duration = config.endTs - config.startTs;
  if (duration < BigInt(limits.minDurationSecs) || duration > BigInt(limits.maxDurationSecs)) {
    fail(ErrorCode.InvalidParams, `duration ${duration}s outside limits`);
  }
  if (config.startTs < now + BigInt(limits.minLeadSecs)) {
    fail(ErrorCode.TooLate, `start_ts must be ≥ now + ${limits.minLeadSecs}s`);
  }
  if (rolloverIn < 0n) fail(ErrorCode.InvalidParams, 'negative rollover');
  for (const side of SIDES) {
    const a = config.assets[side];
    if (a.decimals < 0 || a.decimals > 18) fail(ErrorCode.InvalidParams, `decimals ${a.decimals}`);
    if (a.toleranceSecs < 0n || a.maxConfBps < 0n)
      fail(ErrorCode.InvalidParams, 'negative oracle policy');
  }
  const cfg: ArenaConfig = { ...config, params, feePolicy, limits };
  const state: ArenaState = {
    config: cfg,
    status: 'Scheduled',
    backingCloseTs: cfg.endTs - minHoldSecs(cfg),
    lastAccrualTs: cfg.startTs,
    sides: { A: { ...ZERO_SIDE }, B: { ...ZERO_SIDE } },
    positions: {},
    startPrices: {},
    endPrices: {},
    rewardVault: rolloverIn,
    protocolFees: 0n,
    creatorFees: 0n,
    rolloverIn,
    rolloverOut: 0n,
    sponsors: {},
    sponsorTotal: 0n,
    extensions: 0n,
    extensionSecs: 0n,
    totalClaimed: 0n,
  };
  if (state.backingCloseTs <= cfg.startTs) {
    fail(ErrorCode.InvalidParams, 'min hold leaves no backing window');
  }
  return { state, effects: [{ kind: 'ArenaCreated', rolloverIn }] };
}

// ───────────────────────────────────────────── transitions

function fundPool(s: ArenaState, e: Extract<ArenaEvent, { type: 'fundPool' }>): ApplyResult {
  requireStatus(s, 'Scheduled', 'Live');
  if (e.now >= s.config.endTs) fail(ErrorCode.TooLate, 'pool funding closed at end_ts');
  if (e.amount <= 0n) fail(ErrorCode.ZeroAmount);
  if (!s.config.sponsorOpen && e.sponsor !== s.config.creator && e.sponsor !== s.config.authority) {
    fail(ErrorCode.SponsorClosed);
  }
  const prev = s.sponsors[e.sponsor] ?? { amount: 0n, refunded: false };
  return {
    state: {
      ...s,
      rewardVault: s.rewardVault + e.amount,
      sponsorTotal: s.sponsorTotal + e.amount,
      sponsors: { ...s.sponsors, [e.sponsor]: { amount: prev.amount + e.amount, refunded: false } },
    },
    effects: [{ kind: 'PoolFunded', sponsor: e.sponsor, amount: e.amount }],
  };
}

function snapshotStart(
  s: ArenaState,
  e: Extract<ArenaEvent, { type: 'snapshotStart' }>,
): ApplyResult {
  requireStatus(s, 'Scheduled');
  if (e.now < s.config.startTs) fail(ErrorCode.TooEarly, 'before start_ts');
  if (e.now > s.config.startTs + BigInt(s.config.params.settlementGraceSecs)) {
    fail(ErrorCode.TooLate, 'start grace expired; cancel_expired');
  }
  const startPrices: Partial<Record<SideId, SidePriceSnapshot>> = {};
  for (const side of SIDES) {
    const check = validatePriceUpdate(
      e.prices[side],
      s.config.assets[side],
      s.config.startTs,
      s.config.allowClosedSettlement,
    );
    if (!check.ok) fail(check.code, `${side}: ${check.detail}`);
    startPrices[side] = check.snapshot;
  }
  const a = startPrices.A;
  const b = startPrices.B;
  if (!a || !b) fail(ErrorCode.InvalidParams);
  return {
    state: { ...s, status: 'Live', startPrices: { A: a, B: b }, lastAccrualTs: s.config.startTs },
    effects: [{ kind: 'ArenaStarted', startPrices: { A: a, B: b } }],
  };
}

function back(s0: ArenaState, e: Extract<ArenaEvent, { type: 'back' }>): ApplyResult {
  requireStatus(s0, 'Live');
  if (e.now < s0.config.startTs) fail(ErrorCode.TooEarly);
  if (e.now >= s0.backingCloseTs)
    fail(ErrorCode.BackingClosed, `backing closed at ${s0.backingCloseTs}`);
  if (e.units <= 0n) fail(ErrorCode.ZeroAmount);
  if (e.feePaid < 0n) fail(ErrorCode.InvalidParams, 'negative fee');
  const vals = valuations(s0);
  const asset = s0.config.assets[e.side];
  const notional = notionalUsdc(e.units, vals[e.side].priceQ8, asset.decimals);
  if (notional < s0.config.params.minBackingUsdc) {
    fail(ErrorCode.BelowMinimumBacking, `${notional} < ${s0.config.params.minBackingUsdc}`);
  }
  const required = feeRequired(notional, s0.config.feePolicy.feeBps);
  if (e.feePaid < required) fail(ErrorCode.FeeTooLow, `${e.feePaid} < ${required}`);

  const s = accrueArena(s0, e.now);
  const key = positionKey(e.side, e.owner);
  const existing = s.positions[key];
  const pos = accruePosition(existing ?? newPosition(e.owner, e.side, e.now), e.now, windowOf(s));

  const shareInputs: ShareInputs = { sides: s.sides, valuations: vals };
  const m = underdogMultiplier({
    ...shareInputs,
    side: e.side,
    depositUnits: e.units,
    now: e.now,
    startTs: s.config.startTs,
    endTs: s.config.endTs,
    policy: s.config.params.underdog,
  });

  const { position, side } = applyDeposit(pos, s.sides[e.side], e.units, m.mQ4, e.feePaid);
  const split = splitFee(e.feePaid, s.config.feePolicy);

  return {
    state: {
      ...s,
      sides: { ...s.sides, [e.side]: side },
      positions: { ...s.positions, [key]: position },
      rewardVault: s.rewardVault + split.toPool,
      protocolFees: s.protocolFees + split.toProtocol,
      creatorFees: s.creatorFees + split.toCreator,
    },
    effects: [
      {
        kind: 'Backed',
        owner: e.owner,
        side: e.side,
        units: e.units,
        feePaid: e.feePaid,
        feeRequired: required,
        multiplierQ4: m.mQ4,
        notionalUsdc: notional,
        toPool: split.toPool,
        toProtocol: split.toProtocol,
        toCreator: split.toCreator,
      },
    ],
  };
}

function exit(s0: ArenaState, e: Extract<ArenaEvent, { type: 'exit' }>): ApplyResult {
  // Allowed in every status that can hold positions.
  requireStatus(s0, 'Live', 'Settled', 'Cancelled');
  const existing = getPosition(s0, e.side, e.owner);
  const live = s0.status === 'Live';
  const s = live ? accrueArena(s0, e.now) : s0;
  const pos = live ? accruePosition(existing, e.now, windowOf(s)) : existing;
  const forfeit = live && e.now < s.config.endTs;
  const r = applyExit(pos, s.sides[e.side], e.units, forfeit);
  return {
    state: {
      ...s,
      sides: { ...s.sides, [e.side]: r.side },
      positions: { ...s.positions, [positionKey(e.side, e.owner)]: r.position },
    },
    effects: [
      {
        kind: 'Exited',
        owner: e.owner,
        side: e.side,
        units: e.units,
        forfeitedWeight: r.removedEffSeconds,
      },
    ],
  };
}

function settle(s0: ArenaState, e: Extract<ArenaEvent, { type: 'settle' }>): ApplyResult {
  if (s0.status === 'Settled') fail(ErrorCode.AlreadySettled);
  requireStatus(s0, 'Live');
  if (e.now < s0.config.endTs) fail(ErrorCode.TooEarly, 'before end_ts');
  if (e.now > settlementDeadline(s0))
    fail(ErrorCode.TooLate, 'settlement window expired; cancel_expired');
  if (e.reserveBalance < 0n) fail(ErrorCode.InvalidParams, 'negative reserve');
  const a = s0.startPrices.A;
  const b = s0.startPrices.B;
  if (!a || !b) fail(ErrorCode.InvalidStatus, 'no start snapshot');

  const outcome = resolveSettlement({
    assets: s0.config.assets,
    startSnapshots: { A: a, B: b },
    endInputs: e.prices,
    endTs: s0.config.endTs,
    tieBps: BigInt(s0.config.params.tieBps),
    allowClosedSettlement: s0.config.allowClosedSettlement,
  });
  if (outcome.outcome === 'INVALID') fail(outcome.code, `${outcome.side}: ${outcome.detail}`);

  // Final accrual is clamped at end_ts regardless of how late the crank is.
  const s = accrueArena(s0, e.now);
  const vals = valuations(s);
  const shareInputs: ShareInputs = { sides: s.sides, valuations: vals };

  let winnerTwabShareBps = 5000n;
  let mUpsetQ4 = 10_000n;
  let upsetBonus = 0n;
  let wTotal = 0n;
  if (outcome.winner !== 'TIE') {
    winnerTwabShareBps = settlementTwabShareBps(shareInputs, outcome.winner);
    const u = computeUpsetBonus({
      winnerTwabShareBps,
      basePool: s.rewardVault,
      reserveBalance: e.reserveBalance,
      policy: {
        underdog: s.config.params.underdog,
        reserveDrawBps: s.config.limits.reserveDrawBps,
        upsetBonusCapUsdc: s.config.limits.upsetBonusCapUsdc,
      },
    });
    mUpsetQ4 = u.mUpsetQ4;
    upsetBonus = u.bonus;
    wTotal = s.sides[outcome.winner].effUnitSeconds;
  }
  const poolAtSettlement = s.rewardVault + upsetBonus;
  return {
    state: {
      ...s,
      status: 'Settled',
      endPrices: outcome.endSnapshots,
      rewardVault: poolAtSettlement,
      settlement: {
        winner: outcome.winner,
        perfBpsA: outcome.perfBpsA,
        perfBpsB: outcome.perfBpsB,
        poolAtSettlement,
        wTotal,
        winnerTwabShareBps,
        mUpsetQ4,
        upsetBonus,
        settledAt: e.now,
      },
    },
    effects: [
      {
        kind: 'ArenaSettled',
        winner: outcome.winner,
        perfBpsA: outcome.perfBpsA,
        perfBpsB: outcome.perfBpsB,
        poolAtSettlement,
        upsetBonus,
      },
    ],
  };
}

/**
 * Reward weight of a winning position after final accrual. With
 * `underdogSettlementClamp` the entry-time boost can never exceed the boost
 * the whole-Arena TWAB would have granted (ECONOMICS §7.4 proposal).
 */
export function positionRewardWeight(s: ArenaState, p: PositionState): bigint {
  const st = s.settlement;
  if (!st) fail(ErrorCode.InvalidStatus, 'not settled');
  const final = accruePosition(p, maxBig(s.config.endTs, p.lastTouchTs), windowOf(s));
  if (!s.config.underdogSettlementClamp) return final.effUnitSeconds;
  const clamp = final.unitSeconds * st.mUpsetQ4;
  return final.effUnitSeconds < clamp ? final.effUnitSeconds : clamp;
}

/** Final (end_ts-accrued) reward weights of every winning-side position. */
export function finalWinningWeights(s: ArenaState): WeightedPosition[] {
  const st = s.settlement;
  if (!st || st.winner === 'TIE') return [];
  const out: WeightedPosition[] = [];
  for (const [key, p] of Object.entries(s.positions)) {
    if (p.side !== st.winner) continue;
    out.push({ key, weight: positionRewardWeight(s, p) });
  }
  return out;
}

function claim(s: ArenaState, e: Extract<ArenaEvent, { type: 'claim' }>): ApplyResult {
  requireStatus(s, 'Settled');
  const st = s.settlement;
  if (!st) fail(ErrorCode.InvalidStatus, 'settled without record');
  if (st.winner === 'TIE') fail(ErrorCode.NoWinner);
  if (e.side !== st.winner) fail(ErrorCode.NotWinningSide);
  const existing = getPosition(s, e.side, e.owner);
  if (existing.claimed) fail(ErrorCode.AlreadyClaimed);
  const pos = accruePosition(existing, maxBig(s.config.endTs, existing.lastTouchTs), windowOf(s));
  const weight = positionRewardWeight(s, pos);
  if (weight === 0n) fail(ErrorCode.NoRewardWeight);

  const capBps = BigInt(s.config.params.maxShareBps);
  let amount: bigint;
  if (s.config.distributionMode === 'HardCap' && !s.config.underdogSettlementClamp) {
    amount = payoutHardCap(st.poolAtSettlement, weight, st.wTotal, capBps);
  } else {
    const r = distribute(
      s.config.distributionMode,
      st.poolAtSettlement,
      finalWinningWeights(s),
      capBps,
    );
    amount = r.payouts.get(positionKey(e.side, e.owner)) ?? 0n;
  }
  if (amount === 0n) fail(ErrorCode.NothingToClaim);
  if (amount > s.rewardVault) fail(ErrorCode.InsufficientVault, `${amount} > ${s.rewardVault}`);
  return {
    state: {
      ...s,
      rewardVault: s.rewardVault - amount,
      totalClaimed: s.totalClaimed + amount,
      positions: { ...s.positions, [positionKey(e.side, e.owner)]: { ...pos, claimed: true } },
    },
    effects: [{ kind: 'RewardClaimed', owner: e.owner, side: e.side, amount }],
  };
}

function cancel(s0: ArenaState, e: Extract<ArenaEvent, { type: 'cancel' }>): ApplyResult {
  requireStatus(s0, 'Scheduled', 'Live');
  if (e.actor !== s0.config.authority) fail(ErrorCode.Unauthorized);
  const s = s0.status === 'Live' ? accrueArena(s0, e.now) : s0;
  return {
    state: { ...s, status: 'Cancelled', cancelReason: e.reason },
    effects: [{ kind: 'ArenaCancelled', reason: e.reason, expired: false }],
  };
}

function cancelExpired(
  s0: ArenaState,
  e: Extract<ArenaEvent, { type: 'cancelExpired' }>,
): ApplyResult {
  requireStatus(s0, 'Scheduled', 'Live');
  const grace = BigInt(s0.config.params.settlementGraceSecs);
  if (s0.status === 'Scheduled') {
    if (e.now <= s0.config.startTs + grace) fail(ErrorCode.NotExpired, 'start grace not expired');
  } else if (e.now <= settlementDeadline(s0)) {
    fail(ErrorCode.NotExpired, 'settlement window not expired');
  }
  const s = s0.status === 'Live' ? accrueArena(s0, e.now) : s0;
  return {
    state: { ...s, status: 'Cancelled', cancelReason: 'expired' },
    effects: [{ kind: 'ArenaCancelled', reason: 'expired', expired: true }],
  };
}

function extendSettlement(
  s: ArenaState,
  e: Extract<ArenaEvent, { type: 'extendSettlement' }>,
): ApplyResult {
  requireStatus(s, 'Live');
  if (e.actor !== s.config.authority) fail(ErrorCode.Unauthorized);
  if (e.now < s.config.endTs) fail(ErrorCode.TooEarly, 'before end_ts');
  if (s.extensions > 0n) fail(ErrorCode.AlreadyExtended);
  if (e.secs <= 0n || e.secs > BigInt(s.config.limits.maxExtensionSecs)) {
    fail(ErrorCode.InvalidParams, `extension ${e.secs}s`);
  }
  return {
    state: { ...s, extensions: 1n, extensionSecs: e.secs },
    effects: [{ kind: 'SettlementExtended', secs: e.secs, reason: e.reason }],
  };
}

function refundSponsor(
  s: ArenaState,
  e: Extract<ArenaEvent, { type: 'refundSponsor' }>,
): ApplyResult {
  const sp = s.sponsors[e.sponsor];
  if (!sp) fail(ErrorCode.SponsorNotFound);
  if (sp.refunded) fail(ErrorCode.SponsorAlreadyRefunded);
  const tie = s.status === 'Settled' && s.settlement?.winner === 'TIE';
  if (!(s.status === 'Cancelled' || tie)) fail(ErrorCode.RefundNotAvailable, s.status);
  if (sp.amount > s.rewardVault) fail(ErrorCode.InsufficientVault);
  return {
    state: {
      ...s,
      rewardVault: s.rewardVault - sp.amount,
      sponsorTotal: s.sponsorTotal - sp.amount,
      sponsors: { ...s.sponsors, [e.sponsor]: { ...sp, refunded: true } },
    },
    effects: [{ kind: 'SponsorRefunded', sponsor: e.sponsor, amount: sp.amount }],
  };
}

function sweepUnclaimed(
  s: ArenaState,
  e: Extract<ArenaEvent, { type: 'sweepUnclaimed' }>,
): ApplyResult {
  requireStatus(s, 'Settled');
  const st = s.settlement;
  if (!st) fail(ErrorCode.InvalidStatus);
  if (e.now <= st.settledAt + BigInt(s.config.limits.claimWindowSecs)) {
    fail(ErrorCode.TooEarly, 'claim window open');
  }
  if (s.claimsSweptAt !== undefined) fail(ErrorCode.InvalidStatus, 'already swept');
  // On TIE, sponsors keep the right to refund; only the non-sponsor part rolls.
  const refundable =
    st.winner === 'TIE'
      ? Object.values(s.sponsors).reduce((acc, sp) => (sp.refunded ? acc : acc + sp.amount), 0n)
      : 0n;
  const amount = s.rewardVault - refundable;
  return {
    state: {
      ...s,
      rewardVault: s.rewardVault - amount,
      rolloverOut: s.rolloverOut + amount,
      claimsSweptAt: e.now,
    },
    effects: [{ kind: 'UnclaimedSwept', amount }],
  };
}

export function applyEvent(state: ArenaState, event: ArenaEvent): ApplyResult {
  assertI64(event.now, 'now');
  switch (event.type) {
    case 'fundPool':
      return fundPool(state, event);
    case 'snapshotStart':
      return snapshotStart(state, event);
    case 'back':
      return back(state, event);
    case 'exit':
      return exit(state, event);
    case 'settle':
      return settle(state, event);
    case 'claim':
      return claim(state, event);
    case 'cancel':
      return cancel(state, event);
    case 'cancelExpired':
      return cancelExpired(state, event);
    case 'extendSettlement':
      return extendSettlement(state, event);
    case 'refundSponsor':
      return refundSponsor(state, event);
    case 'sweepUnclaimed':
      return sweepUnclaimed(state, event);
  }
}

/** Replay a whole event stream; throws on the first invalid event. */
export function replay(initial: ArenaState, events: readonly ArenaEvent[]): ApplyResult {
  let state = initial;
  const effects: ArenaEffect[] = [];
  for (const ev of events) {
    const r = applyEvent(state, ev);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

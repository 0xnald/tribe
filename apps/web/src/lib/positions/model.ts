import type { ArenaView, Provenance, SideKey } from '../arena/model';
import { otherSide, sideOf } from '../arena/model';

/** A user's Arena Position as the UI sees it (demo: local; devnet: on-chain). */
export interface PositionRecord {
  id: string;
  provenance: Exclude<Provenance, 'live'>;
  arenaSlug: string;
  arenaId: string;
  side: SideKey;
  /** Whole-token units owned (already divided by decimals). */
  units: number;
  entryTs: number;
  /** USD notional at entry (what the user committed, before fee). */
  usdAtEntry: number;
  feeUsd: number;
  /** Underdog multiplier locked at entry (display). */
  multiplierAtEntry: number;
  txSig?: string;
  status: 'active' | 'exited' | 'claimed';
  /** Devnet: on-chain position address. */
  address?: string;
  /** When exited early (before Arena end) rewards were forfeited. */
  forfeited?: boolean;
}

export type PositionBucket = 'active' | 'claimable' | 'completed' | 'exited';

export interface PositionInsight {
  bucket: PositionBucket;
  /** Current USD value of the owned units. */
  valueUsd: number;
  /** The asset's own move since entry, in percent. */
  ownPct: number;
  /** Arena performance of the user's side since Arena start. */
  sidePct: number;
  opponentPct: number;
  /** Positive when the user's side leads. */
  leadPct: number;
  leading: boolean;
  timeHeldSecs: number;
  /** Reward weight accrued so far: usd × hours held × multiplier. */
  weight: number;
  /** Weight if held to the Arena end (equals `weight` once the Arena is over). */
  projectedWeight: number;
  /** Estimated share of the reward pool (0..1) if held to the end — never guaranteed. */
  estShare: number;
  estRewardUsd: number;
  won: boolean | null;
}

/** Derive everything My Arenas shows from a position and its Arena. Pure; tested. */
export function positionInsight(p: PositionRecord, arena: ArenaView, now: number): PositionInsight {
  const mine = sideOf(arena, p.side);
  const theirs = sideOf(arena, otherSide(p.side));
  const priceEntry = p.units > 0 ? p.usdAtEntry / p.units : mine.startPrice;
  const valueUsd = p.units * mine.price;
  const ownPct = priceEntry > 0 ? ((mine.price - priceEntry) / priceEntry) * 100 : 0;
  const end = Math.min(now, arena.endTs);
  const timeHeldSecs = Math.max(0, end - p.entryTs);
  const forfeited = p.status === 'exited' && p.forfeited;
  const weight = forfeited ? 0 : p.usdAtEntry * (timeHeldSecs / 3600) * p.multiplierAtEntry;
  const fullHoldSecs = Math.max(0, arena.endTs - p.entryTs);
  const projectedWeight = forfeited
    ? 0
    : p.usdAtEntry * (fullHoldSecs / 3600) * p.multiplierAtEntry;
  // Side aggregate weight over the whole window: everyone on the side, average hold ≈ 60 %.
  const duration = Math.max(1, arena.endTs - arena.startTs);
  const sideWeight = Math.max(1, mine.backingUsd * (duration / 3600) * 0.6);
  const estShare = projectedWeight > 0 ? projectedWeight / (sideWeight + projectedWeight) : 0;
  const leadPct = mine.perfPct - theirs.perfPct;
  const leading = leadPct > 0.005;
  const settled = arena.status === 'settled';
  const won = settled
    ? arena.winner === p.side
      ? true
      : arena.winner === 'tie'
        ? null
        : false
    : null;
  const estRewardUsd =
    won === false || (settled && won === null) ? 0 : arena.rewardPoolUsd * estShare;

  let bucket: PositionBucket;
  if (p.status === 'exited') bucket = 'exited';
  else if (p.status === 'claimed') bucket = 'completed';
  else if (settled && won === true) bucket = 'claimable';
  else if (settled || arena.status === 'cancelled') bucket = 'completed';
  else bucket = 'active';

  return {
    bucket,
    valueUsd,
    ownPct,
    sidePct: mine.perfPct,
    opponentPct: theirs.perfPct,
    leadPct,
    leading,
    timeHeldSecs,
    weight,
    projectedWeight,
    estShare,
    estRewardUsd,
    won,
  };
}

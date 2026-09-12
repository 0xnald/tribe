import type { ArenaParams, FeePolicy, ProtocolLimits } from '../config/policy';

/** Two sides of an Arena. */
export type SideId = 'A' | 'B';
export const SIDES: readonly SideId[] = ['A', 'B'];

export function otherSide(side: SideId): SideId {
  return side === 'A' ? 'B' : 'A';
}

/** Asset classes drive oracle staleness policy (ARENA_STATE_MACHINE §5.2). */
export type AssetClass = 'Crypto' | 'Equity' | 'Etf' | 'Commodity';

/** Per-side asset facts the engine needs (a subset of the registry entry). */
export interface ArenaAssetSpec {
  mint: string;
  decimals: number;
  assetClass: AssetClass;
  /** Pyth feed id, 64 hex chars without 0x. */
  feedId: string;
  /** Token-2022 ScaledUiAmount: reference price = underlying × multiplier. */
  scaledUi: boolean;
  /** Exact-mode tolerance around the target timestamp (seconds). */
  toleranceSecs: bigint;
  /** LastKnown mode maximum age (seconds); 0 disables LastKnown. */
  maxClosedStalenessSecs: bigint;
  /** Max confidence interval as bps of price. */
  maxConfBps: bigint;
}

/** Side aggregate — mirrors the on-chain `Side` struct (ECONOMICS §5.3). */
export interface SideState {
  units: bigint;
  /** ∫ units dt — the backing TWAB; never reduced by exits (history). */
  unitSeconds: bigint;
  /** Σ position.unit_seconds — reduced by forfeiture; the raw reward basis (ECONOMICS §7.4). */
  rewardUnitSeconds: bigint;
  effUnits: bigint;
  /** Σ position.eff_unit_seconds — reduced by forfeiture; the boosted reward basis. */
  effUnitSeconds: bigint;
  participants: bigint;
}

/** Position — mirrors the on-chain `Position` account (ECONOMICS §5.2). */
export interface PositionState {
  owner: string;
  side: SideId;
  units: bigint;
  /** ∫ units dt — raw, un-multiplied; used for hold fraction and the optional settlement clamp. */
  unitSeconds: bigint;
  effUnits: bigint;
  effUnitSeconds: bigint;
  entryTs: bigint;
  lastTouchTs: bigint;
  claimed: boolean;
  /** Number of deposits; informational. */
  deposits: bigint;
  /** Cumulative fee paid in micro-USDC; informational. */
  feePaid: bigint;
  /** True once units reached zero before end_ts (MVP forfeiture). */
  forfeited: boolean;
}

export type PriceMode = 'Exact' | 'LastKnown';

export interface SidePriceSnapshot {
  /** Reference price of one raw unit, Q8, multiplier already applied. */
  priceQ8: bigint;
  /** Raw oracle price (before multiplier), Q8. */
  oraclePriceQ8: bigint;
  publishTime: bigint;
  mode: PriceMode;
  /** Scaled-UI multiplier used (Q6); 1_000_000 for non-scaled assets. */
  multQ6: bigint;
}

export type ArenaStatus = 'Scheduled' | 'Live' | 'Settled' | 'Cancelled';

/** Derived, timestamp-aware phase (ARENA_STATE_MACHINE §1). */
export type ArenaPhase =
  'DRAFT' | 'SCHEDULED' | 'LIVE' | 'LOCKED' | 'ENDING' | 'SETTLING' | 'SETTLED' | 'CANCELLED';

export type Winner = SideId | 'TIE';

export interface SettlementRecord {
  winner: Winner;
  perfBpsA: bigint;
  perfBpsB: bigint;
  /** Reward vault balance + upset bonus, frozen at settlement. */
  poolAtSettlement: bigint;
  /**
   * Frozen reward denominator: min(side.eff_unit_seconds, side.reward_unit_seconds × m_settle)
   * for the winning side after final accrual; 0 for TIE (ECONOMICS §6.1).
   */
  wTotal: bigint;
  /** Winning-side whole-Arena TWAB share, bps (ECONOMICS §7.3). */
  winnerTwabShareBps: bigint;
  /** Settlement multiplier from the winner's TWAB share; drives both the Upset Bonus and the clamp. */
  mSettleQ4: bigint;
  upsetBonus: bigint;
  settledAt: bigint;
}

export interface SponsorState {
  amount: bigint;
  refunded: boolean;
}

export interface ArenaConfig {
  creator: string;
  authority: string;
  assets: Record<SideId, ArenaAssetSpec>;
  startTs: bigint;
  endTs: bigint;
  params: ArenaParams;
  feePolicy: FeePolicy;
  limits: ProtocolLimits;
  sponsorOpen: boolean;
  /** Registry policy: allow LastKnown settlement for equity sides. */
  allowClosedSettlement: boolean;
}

export interface ArenaState {
  config: ArenaConfig;
  status: ArenaStatus;
  /** Derived at creation: endTs − minHold. */
  backingCloseTs: bigint;
  /** Arena-level accrual clock for both sides. */
  lastAccrualTs: bigint;
  sides: Record<SideId, SideState>;
  positions: Record<string, PositionState>;
  startPrices: Partial<Record<SideId, SidePriceSnapshot>>;
  endPrices: Partial<Record<SideId, SidePriceSnapshot>>;
  /** USDC micro in the Arena reward vault. */
  rewardVault: bigint;
  /** USDC micro routed to protocol treasury / creator (accounting only). */
  protocolFees: bigint;
  creatorFees: bigint;
  /** Rollover received at creation. */
  rolloverIn: bigint;
  /** Rollover swept out (TIE / dust / unclaimed). */
  rolloverOut: bigint;
  sponsors: Record<string, SponsorState>;
  sponsorTotal: bigint;
  settlement?: SettlementRecord;
  cancelReason?: string;
  extensions: bigint;
  extensionSecs: bigint;
  totalClaimed: bigint;
  claimsSweptAt?: bigint;
}

export function positionKey(side: SideId, owner: string): string {
  return `${side}:${owner}`;
}

export const ZERO_SIDE: SideState = {
  units: 0n,
  unitSeconds: 0n,
  rewardUnitSeconds: 0n,
  effUnits: 0n,
  effUnitSeconds: 0n,
  participants: 0n,
};

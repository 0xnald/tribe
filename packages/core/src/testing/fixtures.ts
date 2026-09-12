import {
  DEFAULT_ARENA_PARAMS,
  DEFAULT_FEE_POLICY,
  DEFAULT_PROTOCOL_LIMITS,
  type ArenaParams,
} from '../config/policy';
import { applyEvent, createArena, type ApplyResult, type ArenaEvent } from '../engine/arena';
import type { PriceInput } from '../engine/oracle';
import type { ArenaAssetSpec, ArenaConfig, ArenaState, SideId } from '../engine/types';

/**
 * Deterministic fixtures shared by unit tests, property tests and the
 * test-vector generator. BONK (legacy SPL, 5 dp) vs TSLAx (Token-2022
 * ScaledUi, 8 dp) with real mainnet mints and Pyth feed ids.
 */

export const BONK: ArenaAssetSpec = {
  mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  decimals: 5,
  assetClass: 'Crypto',
  feedId: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  scaledUi: false,
  toleranceSecs: 60n,
  maxClosedStalenessSecs: 0n,
  maxConfBps: 100n,
};

export const TSLAX: ArenaAssetSpec = {
  mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  decimals: 8,
  assetClass: 'Equity',
  feedId: '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
  scaledUi: true,
  toleranceSecs: 120n,
  maxClosedStalenessSecs: 72n * 3600n,
  maxConfBps: 50n,
};

export const SOL: ArenaAssetSpec = {
  mint: 'So11111111111111111111111111111111111111112',
  decimals: 9,
  assetClass: 'Crypto',
  feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  scaledUi: false,
  toleranceSecs: 60n,
  maxClosedStalenessSecs: 0n,
  maxConfBps: 100n,
};

export const T0 = 1_760_000_000n; // arbitrary epoch base
export const HOUR = 3600n;
export const DAY = 24n * HOUR;

/** $0.00000281 and $365.25 in Q8. */
export const BONK_PRICE_Q8 = 281n;
export const TSLA_PRICE_Q8 = 36_525_000_000n;

export const AUTHORITY = 'AuthKey11111111111111111111111111111111111';
export const CREATOR = 'CreatorKey1111111111111111111111111111111';

export interface ArenaFixtureOptions {
  startTs?: bigint;
  durationSecs?: bigint;
  params?: Partial<ArenaParams>;
  assets?: Record<SideId, ArenaAssetSpec>;
  distributionMode?: ArenaConfig['distributionMode'];
  allowClosedSettlement?: boolean;
  sponsorOpen?: boolean;
  underdogSettlementClamp?: boolean;
}

export function arenaConfig(o: ArenaFixtureOptions = {}): ArenaConfig {
  const startTs = o.startTs ?? T0 + HOUR;
  const duration = o.durationSecs ?? DAY;
  return {
    creator: CREATOR,
    authority: AUTHORITY,
    assets: o.assets ?? { A: BONK, B: TSLAX },
    startTs,
    endTs: startTs + duration,
    params: { ...DEFAULT_ARENA_PARAMS, ...o.params },
    feePolicy: DEFAULT_FEE_POLICY,
    limits: DEFAULT_PROTOCOL_LIMITS,
    sponsorOpen: o.sponsorOpen ?? true,
    distributionMode: o.distributionMode ?? 'HardCap',
    allowClosedSettlement: o.allowClosedSettlement ?? false,
    underdogSettlementClamp: o.underdogSettlementClamp ?? false,
  };
}

export function priceInput(
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

export interface Harness {
  state: ArenaState;
  apply(event: ArenaEvent): ApplyResult;
  /** Start the Arena at start_ts with the given prices (defaults BONK/TSLA). */
  start(prices?: Partial<Record<SideId, bigint>>): ApplyResult;
  back(owner: string, side: SideId, units: bigint, now: bigint, feePaid?: bigint): ApplyResult;
  exit(owner: string, side: SideId, units: bigint, now: bigint): ApplyResult;
  settle(endPrices: Record<SideId, bigint>, now?: bigint, reserve?: bigint): ApplyResult;
  claim(owner: string, side: SideId, now?: bigint): ApplyResult;
}

/** A stateful wrapper around the pure reducer for readable test scripts. */
export function harness(cfg: ArenaConfig = arenaConfig(), createdAt = T0): Harness {
  const h: Harness = {
    state: createArena(cfg, createdAt).state,
    apply(event) {
      const r = applyEvent(h.state, event);
      h.state = r.state;
      return r;
    },
    start(prices = {}) {
      const c = h.state.config;
      return h.apply({
        type: 'snapshotStart',
        now: c.startTs,
        prices: {
          A: priceInput(c.assets.A, prices.A ?? BONK_PRICE_Q8, c.startTs),
          B: priceInput(c.assets.B, prices.B ?? TSLA_PRICE_Q8, c.startTs),
        },
      });
    },
    back(owner, side, units, now, feePaid) {
      const fee = feePaid ?? requiredFeeFor(h.state, side, units);
      return h.apply({ type: 'back', now, owner, side, units, feePaid: fee });
    },
    exit(owner, side, units, now) {
      return h.apply({ type: 'exit', now, owner, side, units });
    },
    settle(endPrices, now, reserve = 0n) {
      const c = h.state.config;
      const at = now ?? c.endTs;
      return h.apply({
        type: 'settle',
        now: at,
        reserveBalance: reserve,
        prices: {
          A: priceInput(c.assets.A, endPrices.A, c.endTs),
          B: priceInput(c.assets.B, endPrices.B, c.endTs),
        },
      });
    },
    claim(owner, side, now) {
      return h.apply({ type: 'claim', now: now ?? h.state.config.endTs + HOUR, owner, side });
    },
  };
  return h;
}

/** The exact on-chain fee requirement for `units` on `side` (uses start price). */
export function requiredFeeFor(state: ArenaState, side: SideId, units: bigint): bigint {
  const p = state.startPrices[side];
  if (!p) throw new Error('arena not started');
  const d = state.config.assets[side].decimals;
  const notional = (units * p.priceQ8) / 10n ** BigInt(d + 2);
  return (notional * BigInt(state.config.feePolicy.feeBps)) / 10_000n;
}

/** Units of `side` worth exactly `usd` (integer dollars) at the start price. */
export function unitsForUsd(state: ArenaState, side: SideId, usd: bigint): bigint {
  const p = state.startPrices[side];
  if (!p) throw new Error('arena not started');
  const d = state.config.assets[side].decimals;
  // units = usd × 1e8 × 10^d / priceQ8
  return (usd * 100_000_000n * 10n ** BigInt(d)) / p.priceQ8;
}

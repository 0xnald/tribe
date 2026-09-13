import { feeRequired } from '@tribe/core';

import { otherSide, sideOf, type ArenaView, type SideKey } from '../arena/model';

/** Everything the Back sheet shows before a transaction. Pure; tested. */
export interface BackPreview {
  side: SideKey;
  symbol: string;
  method: 'usdc' | 'holdings';
  /** USD notional committed (what counts as backing). */
  notionalUsd: number;
  /** Units the position will hold (whole tokens). */
  units: number;
  /** Tribe fee in USD (0.50 % of backing, exact micro-USDC math). */
  feeUsd: number;
  feeSplit: { pool: number; protocol: number; creator: number };
  /** Total USDC leaving the wallet for a USDC buy: notional + fee. */
  totalUsdc: number;
  multiplier: number;
  /** Seconds this position could accrue if held to the end. */
  holdSecs: number;
  /** Estimated reward weight if held to the end: usd × hours × multiplier. */
  weight: number;
  /** Estimated share of the pool (0..1) — labelled estimate, never guaranteed. */
  estShare: number;
  estRewardUsd: number;
  belowMinimum: boolean;
  minimumUsd: number;
}

export interface PreviewInput {
  arena: ArenaView;
  side: SideKey;
  method: 'usdc' | 'holdings';
  /** For `usdc`: USD to spend on the asset. For `holdings`: units to commit. */
  amount: number;
  now: number;
  /** Units per USD from a live quote (overrides the Arena reference price). */
  quotedUnits?: number | undefined;
  minimumUsd?: number;
}

export function buildPreview(inp: PreviewInput): BackPreview {
  const s = sideOf(inp.arena, inp.side);
  const o = sideOf(inp.arena, otherSide(inp.side));
  const minimumUsd = inp.minimumUsd ?? 5;
  let units: number;
  let notionalUsd: number;
  if (inp.method === 'usdc') {
    notionalUsd = Math.max(0, inp.amount);
    units =
      inp.quotedUnits !== undefined ? inp.quotedUnits : s.price > 0 ? notionalUsd / s.price : 0;
  } else {
    units = Math.max(0, inp.amount);
    notionalUsd = units * s.price;
  }
  const micro = BigInt(Math.round(notionalUsd * 1e6));
  const feeMicro = feeRequired(micro, inp.arena.feeBps);
  const feeUsd = Number(feeMicro) / 1e6;
  const feeSplit = { pool: feeUsd * 0.4, protocol: feeUsd * 0.4, creator: feeUsd * 0.2 };
  const holdSecs = Math.max(0, inp.arena.endTs - inp.now);
  const weight = notionalUsd * (holdSecs / 3600) * s.multiplier;
  // side aggregate estimate: existing backing over the whole window at ~60 % average hold
  const duration = Math.max(1, inp.arena.endTs - inp.arena.startTs);
  const sideWeight = Math.max(1, s.backingUsd * (duration / 3600) * 0.6);
  const estShare = weight > 0 ? weight / (sideWeight + weight) : 0;
  void o;
  return {
    side: inp.side,
    symbol: s.asset.symbol,
    method: inp.method,
    notionalUsd,
    units,
    feeUsd,
    feeSplit,
    totalUsdc: inp.method === 'usdc' ? notionalUsd + feeUsd : feeUsd,
    multiplier: s.multiplier,
    holdSecs,
    weight,
    estShare,
    estRewardUsd: inp.arena.rewardPoolUsd * estShare,
    belowMinimum: notionalUsd > 0 && notionalUsd < minimumUsd,
    minimumUsd,
  };
}

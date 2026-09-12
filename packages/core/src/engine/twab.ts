import { assertU128, pow10 } from '../math/fixed';
import type { SideId, SideState } from './types';

/**
 * Backing shares (ECONOMICS §7.1).
 *
 * All values on a side are normalised with that side's Arena start price, so
 * USD figures are comparable across sides. The USD scale here is
 * "USD × 1e8 / 1" (units × Q8 price / 10^decimals) — any common scale works
 * because only ratios are taken.
 */

export interface SideValuation {
  /** Arena start reference price, Q8. */
  priceQ8: bigint;
  decimals: number;
}

export function usdOf(units: bigint, v: SideValuation): bigint {
  return assertU128((units * v.priceQ8) / pow10(v.decimals), 'usd');
}

/** Instantaneous USD backing of a side. */
export function sideUsd(side: SideState, v: SideValuation): bigint {
  return usdOf(side.units, v);
}

/** Time-weighted USD backing (USD·seconds) of a side. */
export function sideUsdSeconds(side: SideState, v: SideValuation): bigint {
  return usdOf(side.unitSeconds, v);
}

export interface ShareInputs {
  sides: Record<SideId, SideState>;
  valuations: Record<SideId, SideValuation>;
}

/**
 * Instantaneous share of `side` in bps AFTER adding `depositUnits` to it.
 * Denominator is never zero when depositUnits > 0 and price > 0.
 */
export function instantShareAfterDepositBps(
  inp: ShareInputs,
  side: SideId,
  depositUnits: bigint,
): bigint {
  const dep = usdOf(depositUnits, inp.valuations[side]);
  const a = sideUsd(inp.sides.A, inp.valuations.A);
  const b = sideUsd(inp.sides.B, inp.valuations.B);
  const mine = (side === 'A' ? a : b) + dep;
  const total = a + b + dep;
  if (total === 0n) return 5000n; // zero-value deposit (only reachable with dust prices)
  return (mine * 10_000n) / total;
}

/**
 * Time-weighted share of `side` in bps BEFORE the deposit, or `null` when no
 * time has accrued on either side yet (TWAB undefined).
 */
export function twabShareBps(inp: ShareInputs, side: SideId): bigint | null {
  const a = sideUsdSeconds(inp.sides.A, inp.valuations.A);
  const b = sideUsdSeconds(inp.sides.B, inp.valuations.B);
  const total = a + b;
  if (total === 0n) return null;
  return ((side === 'A' ? a : b) * 10_000n) / total;
}

/** Whole-Arena TWAB share used at settlement (ECONOMICS §7.3); 5000 if nothing accrued. */
export function settlementTwabShareBps(inp: ShareInputs, side: SideId): bigint {
  return twabShareBps(inp, side) ?? 5000n;
}

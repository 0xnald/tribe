import { decideWinner, perfBps } from '../math/fixed';
import type { ErrorCode as ErrorCodeT } from './errors';
import { validatePriceUpdate, type PriceInput } from './oracle';
import type { ArenaAssetSpec, SideId, SidePriceSnapshot, Winner } from './types';

/**
 * Pure settlement (ECONOMICS §2). Given start and end snapshots, decide the
 * winner; given raw oracle inputs, validate them first and report INVALID
 * with the failing side and reason instead of throwing.
 */

export interface SettlementPrices {
  A: { startQ8: bigint; endQ8: bigint };
  B: { startQ8: bigint; endQ8: bigint };
}

export interface SettlementResult {
  winner: Winner;
  perfBpsA: bigint;
  perfBpsB: bigint;
}

export function settleFromPrices(p: SettlementPrices, tieBps: bigint): SettlementResult {
  const winner = decideWinner(p.A.startQ8, p.A.endQ8, p.B.startQ8, p.B.endQ8, tieBps);
  return {
    winner,
    perfBpsA: perfBps(p.A.startQ8, p.A.endQ8),
    perfBpsB: perfBps(p.B.startQ8, p.B.endQ8),
  };
}

export type SettlementOutcome =
  | ({
      outcome: 'SIDE_A' | 'SIDE_B' | 'TIE';
      endSnapshots: Record<SideId, SidePriceSnapshot>;
    } & SettlementResult)
  | { outcome: 'INVALID'; side: SideId; code: ErrorCodeT; detail: string };

export interface ResolveInputs {
  assets: Record<SideId, ArenaAssetSpec>;
  startSnapshots: Record<SideId, SidePriceSnapshot>;
  endInputs: Record<SideId, PriceInput>;
  endTs: bigint;
  tieBps: bigint;
  allowClosedSettlement: boolean;
}

/** Validate end-of-Arena oracle inputs and settle, or report INVALID. */
export function resolveSettlement(inp: ResolveInputs): SettlementOutcome {
  const endSnapshots: Partial<Record<SideId, SidePriceSnapshot>> = {};
  for (const side of ['A', 'B'] as const) {
    const check = validatePriceUpdate(
      inp.endInputs[side],
      inp.assets[side],
      inp.endTs,
      inp.allowClosedSettlement,
    );
    if (!check.ok) return { outcome: 'INVALID', side, code: check.code, detail: check.detail };
    endSnapshots[side] = check.snapshot;
  }
  const a = endSnapshots.A;
  const b = endSnapshots.B;
  if (!a || !b) throw new Error('unreachable: missing snapshot');
  const r = settleFromPrices(
    {
      A: { startQ8: inp.startSnapshots.A.priceQ8, endQ8: a.priceQ8 },
      B: { startQ8: inp.startSnapshots.B.priceQ8, endQ8: b.priceQ8 },
    },
    inp.tieBps,
  );
  const outcome = r.winner === 'A' ? 'SIDE_A' : r.winner === 'B' ? 'SIDE_B' : 'TIE';
  return { outcome, endSnapshots: { A: a, B: b }, ...r };
}

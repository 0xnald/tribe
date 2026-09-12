import { MULT_Q6 } from '../constants';
import { MathError, refPriceQ8, toQ8 } from '../math/fixed';
import { ErrorCode, type ErrorCode as ErrorCodeT } from './errors';
import type { ArenaAssetSpec, PriceMode, SidePriceSnapshot } from './types';

/**
 * Oracle input validation (ARCHITECTURE §5.3, ARENA_STATE_MACHINE §5.1–5.2).
 * Mirrors the checks the program performs on a Pyth `PriceUpdateV2` account.
 */

export type VerificationLevel = 'Full' | 'Partial';

export interface PriceInput {
  feedId: string;
  price: bigint;
  /** Pyth confidence interval, same exponent as price. */
  conf: bigint;
  expo: number;
  publishTime: bigint;
  verificationLevel: VerificationLevel;
  /** For ScaledUi mints: multiplier read from the mint at snapshot time (Q6). */
  multQ6?: bigint;
}

export type OracleCheck =
  { ok: true; snapshot: SidePriceSnapshot } | { ok: false; code: ErrorCodeT; detail: string };

/**
 * Validate a price update against the asset policy for a target timestamp.
 *
 * Exact mode:     |publish − target| ≤ tolerance
 * LastKnown mode: target − maxClosedStaleness ≤ publish ≤ target  (equities
 *                 outside market hours; requires allowClosed)
 */
export function validatePriceUpdate(
  input: PriceInput,
  asset: ArenaAssetSpec,
  targetTs: bigint,
  allowClosed: boolean,
): OracleCheck {
  if (input.feedId.toLowerCase() !== asset.feedId.toLowerCase()) {
    return {
      ok: false,
      code: ErrorCode.OracleFeedMismatch,
      detail: `${input.feedId} ≠ ${asset.feedId}`,
    };
  }
  if (input.verificationLevel !== 'Full') {
    return { ok: false, code: ErrorCode.OracleNotFullyVerified, detail: input.verificationLevel };
  }
  if (input.price <= 0n) {
    return { ok: false, code: ErrorCode.OracleNonPositivePrice, detail: `${input.price}` };
  }
  if (input.conf < 0n) {
    return { ok: false, code: ErrorCode.OracleConfidenceTooWide, detail: 'negative conf' };
  }
  // conf × 10_000 / price ≤ maxConfBps  (same exponent, so no normalisation needed)
  if ((input.conf * 10_000n) / input.price > asset.maxConfBps) {
    return {
      ok: false,
      code: ErrorCode.OracleConfidenceTooWide,
      detail: `conf ${input.conf} / price ${input.price}`,
    };
  }

  let mode: PriceMode;
  const diff = input.publishTime - targetTs;
  const absDiff = diff < 0n ? -diff : diff;
  if (absDiff <= asset.toleranceSecs) {
    mode = 'Exact';
  } else if (diff > 0n) {
    return { ok: false, code: ErrorCode.OracleTooEarly, detail: `published ${diff}s after target` };
  } else {
    const lastKnownAllowed =
      allowClosed && asset.assetClass !== 'Crypto' && asset.maxClosedStalenessSecs > 0n;
    if (!lastKnownAllowed || absDiff > asset.maxClosedStalenessSecs) {
      return {
        ok: false,
        code: ErrorCode.OracleStale,
        detail: `published ${absDiff}s before target`,
      };
    }
    mode = 'LastKnown';
  }

  let oraclePriceQ8: bigint;
  try {
    oraclePriceQ8 = toQ8(input.price, input.expo);
  } catch (e) {
    return {
      ok: false,
      code: e instanceof MathError ? ErrorCode.OracleUnsupportedExponent : ErrorCode.MathOverflow,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const multQ6 = asset.scaledUi ? (input.multQ6 ?? MULT_Q6) : MULT_Q6;
  if (multQ6 <= 0n) {
    return { ok: false, code: ErrorCode.InvalidParams, detail: 'multiplier must be > 0' };
  }
  let priceQ8: bigint;
  try {
    priceQ8 = refPriceQ8(oraclePriceQ8, multQ6);
  } catch (e) {
    return {
      ok: false,
      code: ErrorCode.MathOverflow,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    ok: true,
    snapshot: { priceQ8, oraclePriceQ8, publishTime: input.publishTime, mode, multQ6 },
  };
}

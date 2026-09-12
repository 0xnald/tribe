import { MULT_Q6 } from '../constants';

/**
 * Fixed-point primitives from docs/ECONOMICS.md §0 and §2.
 * All functions take and return bigint; none use floating point.
 */

export class MathError extends Error {
  override readonly name = 'MathError';
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export function assertU64(x: bigint, label = 'value'): bigint {
  if (x < 0n || x > U64_MAX) throw new MathError(`${label} out of u64 range: ${x}`);
  return x;
}

export function assertU128(x: bigint, label = 'value'): bigint {
  if (x < 0n || x > U128_MAX) throw new MathError(`${label} out of u128 range: ${x}`);
  return x;
}

export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > 38) throw new MathError(`bad exponent ${n}`);
  return 10n ** BigInt(n);
}

/**
 * Normalise a Pyth-style (price, expo) pair to Q8 (USD × 1e8).
 * Rejects non-positive prices and exponents outside a sane range.
 */
export function toQ8(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new MathError('price must be > 0');
  if (!Number.isInteger(expo) || expo < -18 || expo > 8) {
    throw new MathError(`unsupported expo ${expo}`);
  }
  const shift = 8 + expo; // expo −8 → no shift
  const q8 = shift >= 0 ? price * pow10(shift) : price / pow10(-shift);
  if (q8 <= 0n) throw new MathError('price underflows Q8');
  return assertU64(q8, 'price_q8');
}

/** Reference price of one raw unit: xStocks multiply the underlying price by the scaled-UI multiplier. */
export function refPriceQ8(underlyingQ8: bigint, multQ6: bigint = MULT_Q6): bigint {
  if (multQ6 <= 0n) throw new MathError('multiplier must be > 0');
  return assertU64((underlyingQ8 * multQ6) / MULT_Q6, 'ref_price_q8');
}

/** notional_usdc(units, P_ref, d) = units × P_ref / 10^(d + 2)  → micro-USDC. */
export function notionalUsdc(units: bigint, priceQ8: bigint, decimals: number): bigint {
  assertU64(units, 'units');
  assertU64(priceQ8, 'price_q8');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MathError(`bad decimals ${decimals}`);
  }
  return (units * priceQ8) / pow10(decimals + 2);
}

/** perf_bps = (P_end − P_start) × 10_000 / P_start, floored toward −∞ (Rust i128 div_euclid). */
export function perfBps(startQ8: bigint, endQ8: bigint): bigint {
  if (startQ8 <= 0n) throw new MathError('start price must be > 0');
  const num = (endQ8 - startQ8) * 10_000n;
  const q = num / startQ8; // bigint division truncates toward zero
  return num < 0n && q * startQ8 !== num ? q - 1n : q;
}

export type Winner = 'A' | 'B' | 'TIE';

/** Division-free winner rule with a tie band — docs/ECONOMICS.md §2. */
export function decideWinner(
  startA: bigint,
  endA: bigint,
  startB: bigint,
  endB: bigint,
  tieBps: bigint,
): Winner {
  const prices: ReadonlyArray<readonly [bigint, string]> = [
    [startA, 'startA'],
    [endA, 'endA'],
    [startB, 'startB'],
    [endB, 'endB'],
  ];
  for (const [p, label] of prices) {
    if (p <= 0n) throw new MathError(`${label} must be > 0`);
    assertU64(p, label);
  }
  const lhs = assertU128(endA * startB, 'lhs');
  const rhs = assertU128(endB * startA, 'rhs');
  const band = assertU128((tieBps * startA * startB) / 10_000n, 'tie_band');
  const diff = lhs > rhs ? lhs - rhs : rhs - lhs;
  if (diff <= band) return 'TIE';
  return lhs > rhs ? 'A' : 'B';
}

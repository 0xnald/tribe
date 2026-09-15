import { MULT_Q6, PRICE_DECIMALS } from '../constants';

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
 * Normalise a Pyth-style (price, expo) pair to Q10 (USD × 1e10).
 * Rejects non-positive prices and exponents outside a sane range. The
 * result must fit u64, which bounds the reference price at
 * ≈ $1 844 674 407 per unit.
 */
export function toQ10(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new MathError('price must be > 0');
  if (!Number.isInteger(expo) || expo < -18 || expo > 8) {
    throw new MathError(`unsupported expo ${expo}`);
  }
  const shift = PRICE_DECIMALS + expo; // expo −10 → no shift
  const q10 = shift >= 0 ? price * pow10(shift) : price / pow10(-shift);
  if (q10 <= 0n) throw new MathError('price underflows Q10');
  return assertU64(q10, 'price_q10');
}

/** Reference price of one raw unit: xStocks multiply the underlying price by the scaled-UI multiplier. */
export function refPriceQ10(underlyingQ10: bigint, multQ6: bigint = MULT_Q6): bigint {
  if (multQ6 <= 0n) throw new MathError('multiplier must be > 0');
  return assertU64((underlyingQ10 * multQ6) / MULT_Q6, 'ref_price_q10');
}

/** notional_usdc(units, P_ref, d) = units × P_ref / 10^(d + 4)  → micro-USDC (Q10 → 1e6 USDC). */
export function notionalUsdc(units: bigint, priceQ10: bigint, decimals: number): bigint {
  assertU64(units, 'units');
  assertU64(priceQ10, 'price_q10');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MathError(`bad decimals ${decimals}`);
  }
  return (units * priceQ10) / pow10(decimals + PRICE_DECIMALS - 6);
}

/** perf_bps = (P_end − P_start) × 10_000 / P_start, floored toward −∞ (Rust i128 div_euclid). Scale-free. */
export function perfBps(startQ10: bigint, endQ10: bigint): bigint {
  if (startQ10 <= 0n) throw new MathError('start price must be > 0');
  const num = (endQ10 - startQ10) * 10_000n;
  const q = num / startQ10; // bigint division truncates toward zero
  return num < 0n && q * startQ10 !== num ? q - 1n : q;
}

export type WinnerSide = 'A' | 'B' | 'TIE';

const U256_MAX = (1n << 256n) - 1n;

export function assertU256(x: bigint, label = 'value'): bigint {
  if (x < 0n || x > U256_MAX) throw new MathError(`${label} out of u256 range: ${x}`);
  return x;
}

/**
 * Division-free winner rule with a tie band — docs/ECONOMICS.md §2.
 * Scale-free; the cross products use 256-bit intermediates (the Rust
 * engine uses U256 too), so any u64 prices are safe.
 */
export function decideWinner(
  startA: bigint,
  endA: bigint,
  startB: bigint,
  endB: bigint,
  tieBps: bigint,
): WinnerSide {
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
  const lhs = assertU256(endA * startB, 'lhs');
  const rhs = assertU256(endB * startA, 'rhs');
  const band = assertU256((tieBps * startA * startB) / 10_000n, 'tie_band');
  const diff = lhs > rhs ? lhs - rhs : rhs - lhs;
  if (diff <= band) return 'TIE';
  return lhs > rhs ? 'A' : 'B';
}

/** Saturating-free helpers mirroring Rust `checked_*` semantics (throw instead of wrap). */
export function clampBig(x: bigint, lo: bigint, hi: bigint): bigint {
  if (lo > hi) throw new MathError(`clamp bounds inverted: ${lo} > ${hi}`);
  return x < lo ? lo : x > hi ? hi : x;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** floor(a × b / d) in u128 with an explicit zero-divisor error. */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new MathError('division by zero');
  return assertU128((a * b) / d, 'mul_div');
}

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export function assertI64(x: bigint, label = 'value'): bigint {
  if (x < I64_MIN || x > I64_MAX) throw new MathError(`${label} out of i64 range: ${x}`);
  return x;
}

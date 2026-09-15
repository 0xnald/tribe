/** Fixed product vocabulary — see docs/PRODUCT.md §3. Do not rename without approval. */
export const PROTOCOL_NAME = 'Tribe' as const;
export const TAGLINE = "Don't bet on what you believe in. Own it." as const;

export const TERMS = {
  primitive: 'Arena',
  action: 'Back',
  position: 'Arena Position',
  capitalMetric: 'Backing',
  outcome: 'Arena Winner',
  rewards: 'Arena Rewards',
  compounding: 'Victory Roll',
  reputation: 'Conviction Score',
  creator: 'Arena Creator',
} as const;

/** Basis points denominator. */
export const BPS = 10_000n;
/** Underdog multiplier fixed-point scale (Q4): 10_000 = 1.0×. */
export const Q4 = 10_000n;
/** Reference-price scale (Q10): USD × 10^10. Chosen so sub-cent assets (BONK ≈ $0.0000027 → 27 000) keep bps resolution. */
export const Q10 = 10_000_000_000n;
/** Decimal exponent of the reference-price scale. */
export const PRICE_DECIMALS = 10;
/** xStocks scaled-UI multiplier scale (Q6): 1_000_000 = 1.0. */
export const MULT_Q6 = 1_000_000n;
/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;

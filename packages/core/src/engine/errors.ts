/**
 * Engine error codes. The Anchor program mirrors these one-to-one as its
 * `#[error_code]` enum so test vectors can assert on the same identifiers.
 */
export const ErrorCode = {
  // clock / ordering
  NonMonotonicClock: 'NonMonotonicClock',
  // state
  InvalidStatus: 'InvalidStatus',
  TooEarly: 'TooEarly',
  TooLate: 'TooLate',
  BackingClosed: 'BackingClosed',
  AlreadySettled: 'AlreadySettled',
  AlreadyExtended: 'AlreadyExtended',
  NotExpired: 'NotExpired',
  // inputs
  ZeroAmount: 'ZeroAmount',
  BelowMinimumBacking: 'BelowMinimumBacking',
  FeeTooLow: 'FeeTooLow',
  InsufficientUnits: 'InsufficientUnits',
  InvalidParams: 'InvalidParams',
  SameAsset: 'SameAsset',
  // oracle
  OracleFeedMismatch: 'OracleFeedMismatch',
  OracleNotFullyVerified: 'OracleNotFullyVerified',
  OracleNonPositivePrice: 'OracleNonPositivePrice',
  OracleConfidenceTooWide: 'OracleConfidenceTooWide',
  OracleStale: 'OracleStale',
  OracleTooEarly: 'OracleTooEarly',
  OracleUnsupportedExponent: 'OracleUnsupportedExponent',
  // positions / claims
  PositionNotFound: 'PositionNotFound',
  AlreadyClaimed: 'AlreadyClaimed',
  NotWinningSide: 'NotWinningSide',
  NoWinner: 'NoWinner',
  NoRewardWeight: 'NoRewardWeight',
  NothingToClaim: 'NothingToClaim',
  // sponsors
  SponsorNotFound: 'SponsorNotFound',
  SponsorAlreadyRefunded: 'SponsorAlreadyRefunded',
  SponsorClosed: 'SponsorClosed',
  RefundNotAvailable: 'RefundNotAvailable',
  InsufficientVault: 'InsufficientVault',
  // auth
  Unauthorized: 'Unauthorized',
  // math
  MathOverflow: 'MathOverflow',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class TribeError extends Error {
  override readonly name = 'TribeError';
  constructor(
    readonly code: ErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function fail(code: ErrorCode, detail?: string): never {
  throw new TribeError(code, detail);
}

export function isTribeError(e: unknown, code?: ErrorCode): e is TribeError {
  return e instanceof TribeError && (code === undefined || e.code === code);
}

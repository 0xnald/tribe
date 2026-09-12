import { z } from 'zod';

/**
 * Market-quality gates (ARCHITECTURE §6). Pure, deterministic, threshold-driven.
 * Inputs are the facts an indexer collects (Jupiter Tokens v2 / Price v3,
 * xStocks API, Pyth feed metadata, on-chain mint extensions); the output is a
 * machine-readable verdict that the registry admission process consumes.
 */

export const TokenProgramSchema = z.enum(['TokenProgram', 'Token2022', 'Unknown']);
export type TokenProgram = z.infer<typeof TokenProgramSchema>;

/** Token-2022 mint extensions we recognise. */
export const MintExtensionSchema = z.enum([
  'MetadataPointer',
  'TokenMetadata',
  'ScaledUiAmount',
  'Pausable',
  'PermanentDelegate',
  'DefaultAccountState',
  'ConfidentialTransferMint',
  'TransferHook',
  'TransferFeeConfig',
  'NonTransferable',
  'InterestBearing',
  'MintCloseAuthority',
  'GroupPointer',
  'GroupMemberPointer',
  'Unknown',
]);
export type MintExtension = z.infer<typeof MintExtensionSchema>;

export const AssetQualityInputSchema = z.object({
  symbol: z.string(),
  mint: z.string(),
  tokenProgram: TokenProgramSchema,
  extensions: z.array(MintExtensionSchema).default([]),
  /** Non-null program id means an active transfer hook. */
  transferHookProgram: z.string().nullable().default(null),
  /** USD, from Jupiter Price v3 `liquidity`. */
  liquidityUsd: z.number().nonnegative(),
  /** USD, 24 h buy+sell volume. */
  volume24hUsd: z.number().nonnegative(),
  /** USD, 24 h organic buy+sell volume per Jupiter; null when not reported. */
  organicVolume24hUsd: z.number().nonnegative().nullable().default(null),
  /** Jupiter organic score 0..100; null when not reported. */
  organicScore: z.number().min(0).max(100).nullable().default(null),
  jupiterVerified: z.boolean().nullable().default(null),
  /** Jupiter audit.isSus (present only when true). */
  flaggedSuspicious: z.boolean().default(false),
  marketAgeDays: z.number().nonnegative(),
  /** Pyth feed present in the registry mapping. */
  oracleFeedId: z.string().nullable(),
  /** Seconds since the last oracle publish; null = never / unknown. */
  oracleAgeSecs: z.number().nonnegative().nullable(),
  /** Latest confidence / price in bps; null = unknown. */
  oracleConfBps: z.number().nonnegative().nullable(),
  /** For equities: whether the last publish is inside the current/last session (null for crypto). */
  oracleMarketOpen: z.boolean().nullable().default(null),
  /** Issuer trading halt (xStocks `isTradingHalted`); false for crypto. */
  issuerHalted: z.boolean().default(false),
  /** Wash score 0..1 from the DN-Institute style pool screen; null = not screened. */
  washScore: z.number().min(0).max(1).nullable().default(null),
  /** Display price sources available (e.g. ['pyth', 'jupiter']). */
  priceSources: z.array(z.string()).default([]),
});
export type AssetQualityInput = z.infer<typeof AssetQualityInputSchema>;

export const QualityThresholdsSchema = z.object({
  minLiquidityUsd: z.number().nonnegative(),
  warnLiquidityUsd: z.number().nonnegative(),
  minVolume24hUsd: z.number().nonnegative(),
  minMarketAgeDays: z.number().nonnegative(),
  minOrganicRatio: z.number().min(0).max(1),
  minOrganicScore: z.number().min(0).max(100),
  maxOracleAgeSecsCrypto: z.number().nonnegative(),
  maxOracleAgeSecsEquity: z.number().nonnegative(),
  maxOracleConfBps: z.number().nonnegative(),
  washScoreReject: z.number().min(0).max(1),
  washScoreWarn: z.number().min(0).max(1),
  requireJupiterVerified: z.boolean(),
  unsupportedExtensions: z.array(MintExtensionSchema),
  reviewExtensions: z.array(MintExtensionSchema),
});
export type QualityThresholds = z.infer<typeof QualityThresholdsSchema>;

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = QualityThresholdsSchema.parse({
  minLiquidityUsd: 250_000,
  warnLiquidityUsd: 1_000_000,
  minVolume24hUsd: 50_000,
  minMarketAgeDays: 30,
  // Jupiter's organic volume is a small fraction even for SOL (~1.3 %); the ratio is a sanity
  // floor only — organicScore and the wash screen carry the signal.
  minOrganicRatio: 0.01,
  minOrganicScore: 40,
  maxOracleAgeSecsCrypto: 24 * 3600,
  maxOracleAgeSecsEquity: 72 * 3600,
  maxOracleConfBps: 100,
  washScoreReject: 0.6,
  washScoreWarn: 0.3,
  requireJupiterVerified: true,
  unsupportedExtensions: ['TransferFeeConfig', 'NonTransferable', 'InterestBearing'],
  reviewExtensions: ['PermanentDelegate', 'Pausable', 'ConfidentialTransferMint'],
});

export const REASON_CODES = [
  'OK',
  'NO_ORACLE',
  'ORACLE_STALE',
  'ORACLE_CONF_WIDE',
  'ORACLE_MARKET_CLOSED',
  'LIQUIDITY_BELOW_MIN',
  'LIQUIDITY_THIN',
  'VOLUME_BELOW_MIN',
  'MARKET_TOO_YOUNG',
  'ORGANIC_RATIO_LOW',
  'ORGANIC_SCORE_LOW',
  'NOT_VERIFIED',
  'FLAGGED_SUSPICIOUS',
  'ISSUER_HALTED',
  'WASH_FLAGGED',
  'WASH_SUSPECTED',
  'WASH_NOT_SCREENED',
  'UNSUPPORTED_TOKEN_PROGRAM',
  'UNSUPPORTED_EXTENSION',
  'ACTIVE_TRANSFER_HOOK',
  'ISSUER_CONTROLLED_EXTENSION',
  'NO_DISPLAY_PRICE_SOURCE',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type QualityStatus = 'ELIGIBLE' | 'WARNING' | 'REJECTED';

export interface QualityReason {
  code: ReasonCode;
  severity: 'reject' | 'warn' | 'info';
  detail: string;
}

export interface QualityVerdict {
  symbol: string;
  mint: string;
  status: QualityStatus;
  reasons: QualityReason[];
  /** Asset class inferred for oracle staleness: equity-like when oracleMarketOpen is not null. */
  equityLike: boolean;
}

export function evaluateAssetQuality(
  raw: AssetQualityInput,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): QualityVerdict {
  const a = AssetQualityInputSchema.parse(raw);
  const t = QualityThresholdsSchema.parse(thresholds);
  const reasons: QualityReason[] = [];
  const reject = (code: ReasonCode, detail: string) =>
    reasons.push({ code, severity: 'reject', detail });
  const warn = (code: ReasonCode, detail: string) =>
    reasons.push({ code, severity: 'warn', detail });
  const equityLike = a.oracleMarketOpen !== null;

  // ── token program & extensions (hard requirements)
  if (a.tokenProgram === 'Unknown')
    reject('UNSUPPORTED_TOKEN_PROGRAM', 'mint owner is not a supported token program');
  for (const ext of a.extensions) {
    if (t.unsupportedExtensions.includes(ext))
      reject('UNSUPPORTED_EXTENSION', `${ext} breaks vault accounting`);
    else if (t.reviewExtensions.includes(ext))
      reasons.push({
        code: 'ISSUER_CONTROLLED_EXTENSION',
        severity: 'info',
        detail: `${ext}: issuer may pause/seize/freeze; disclosed in UI`,
      });
  }
  if (a.transferHookProgram !== null)
    reject('ACTIVE_TRANSFER_HOOK', `transfer hook ${a.transferHookProgram} not supported`);

  // ── oracle
  if (a.oracleFeedId === null) reject('NO_ORACLE', 'no Pyth feed mapped');
  else {
    const maxAge = equityLike ? t.maxOracleAgeSecsEquity : t.maxOracleAgeSecsCrypto;
    if (a.oracleAgeSecs === null) reject('ORACLE_STALE', 'feed has never published');
    else if (a.oracleAgeSecs > maxAge)
      reject('ORACLE_STALE', `last publish ${a.oracleAgeSecs}s ago > ${maxAge}s`);
    if (a.oracleConfBps !== null && a.oracleConfBps > t.maxOracleConfBps)
      reject('ORACLE_CONF_WIDE', `${a.oracleConfBps} bps > ${t.maxOracleConfBps}`);
    if (equityLike && a.oracleMarketOpen === false)
      reasons.push({
        code: 'ORACLE_MARKET_CLOSED',
        severity: 'info',
        detail: 'reference price frozen outside market hours',
      });
  }
  if (a.priceSources.length === 0) reject('NO_DISPLAY_PRICE_SOURCE', 'no display price source');

  // ── issuer / venue status
  if (a.issuerHalted) reject('ISSUER_HALTED', 'issuer reports trading halted');
  if (a.flaggedSuspicious) reject('FLAGGED_SUSPICIOUS', 'Jupiter audit.isSus');
  if (t.requireJupiterVerified && a.jupiterVerified !== true)
    reject('NOT_VERIFIED', 'not Jupiter-verified');

  // ── liquidity / volume / age
  if (a.liquidityUsd < t.minLiquidityUsd)
    reject('LIQUIDITY_BELOW_MIN', `$${a.liquidityUsd} < $${t.minLiquidityUsd}`);
  else if (a.liquidityUsd < t.warnLiquidityUsd)
    warn('LIQUIDITY_THIN', `$${a.liquidityUsd} < $${t.warnLiquidityUsd}; expect slippage`);
  if (a.volume24hUsd < t.minVolume24hUsd)
    reject('VOLUME_BELOW_MIN', `$${a.volume24hUsd} < $${t.minVolume24hUsd}`);
  if (a.marketAgeDays < t.minMarketAgeDays)
    reject('MARKET_TOO_YOUNG', `${a.marketAgeDays}d < ${t.minMarketAgeDays}d`);

  // ── organic volume / wash
  if (a.organicVolume24hUsd !== null && a.volume24hUsd > 0) {
    const ratio = a.organicVolume24hUsd / a.volume24hUsd;
    if (ratio < t.minOrganicRatio) {
      // A low organic ratio alone is a warning (xStocks pools show ~20-25 %); combined with a low
      // organic score or a wash flag it becomes a rejection below.
      warn(
        'ORGANIC_RATIO_LOW',
        `organic ${(ratio * 100).toFixed(1)}% < ${t.minOrganicRatio * 100}%`,
      );
    }
  }
  if (a.organicScore !== null && a.organicScore < t.minOrganicScore)
    reject('ORGANIC_SCORE_LOW', `${a.organicScore} < ${t.minOrganicScore}`);
  if (a.washScore === null) warn('WASH_NOT_SCREENED', 'pool wash screen not run');
  else if (a.washScore >= t.washScoreReject)
    reject('WASH_FLAGGED', `wash score ${a.washScore} ≥ ${t.washScoreReject}`);
  else if (a.washScore >= t.washScoreWarn)
    warn('WASH_SUSPECTED', `wash score ${a.washScore} ≥ ${t.washScoreWarn}`);

  const status: QualityStatus = reasons.some((r) => r.severity === 'reject')
    ? 'REJECTED'
    : reasons.some((r) => r.severity === 'warn')
      ? 'WARNING'
      : 'ELIGIBLE';
  if (status === 'ELIGIBLE')
    reasons.push({ code: 'OK', severity: 'info', detail: 'all gates passed' });
  return { symbol: a.symbol, mint: a.mint, status, reasons, equityLike };
}

import { describe, expect, it } from 'vitest';

import { QUALITY_FIXTURES } from './fixtures';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  evaluateAssetQuality,
  type AssetQualityInput,
  type ReasonCode,
} from './quality';

function fx(key: string): AssetQualityInput {
  const f = QUALITY_FIXTURES[key];
  if (!f) throw new Error(`missing fixture ${key}`);
  return f;
}
const codes = (key: string): ReasonCode[] =>
  evaluateAssetQuality(fx(key)).reasons.map((r) => r.code);
const status = (key: string) => evaluateAssetQuality(fx(key)).status;

describe('market quality — seed fixtures', () => {
  it('SOL and BONK are ELIGIBLE (BONK gets a thin-liquidity warning)', () => {
    expect(status('SOL')).toBe('ELIGIBLE');
    expect(codes('SOL')).toEqual(['OK']);
    expect(status('BONK')).toBe('ELIGIBLE');
  });
  it('PENGU (healthy midcap meme) is ELIGIBLE', () => {
    expect(status('PENGU')).toBe('ELIGIBLE');
  });
  it('TSLAx is WARNING: Orca wash signature; issuer extensions and market-closed disclosed', () => {
    const v = evaluateAssetQuality(fx('TSLAx'));
    expect(v.status).toBe('WARNING');
    expect(v.equityLike).toBe(true);
    const c = v.reasons.map((r) => r.code);
    expect(c).toContain('WASH_SUSPECTED');
    expect(c).toContain('ISSUER_CONTROLLED_EXTENSION');
    expect(c).toContain('ORACLE_MARKET_CLOSED');
    expect(c).not.toContain('ACTIVE_TRANSFER_HOOK'); // extension present but program id null
    expect(v.reasons.every((r) => r.severity !== 'reject')).toBe(true);
  });
  it('NVDAx is ELIGIBLE (no wash flag) with issuer extensions disclosed as info', () => {
    const c = codes('NVDAx');
    expect(status('NVDAx')).toBe('ELIGIBLE');
    expect(c).toContain('ISSUER_CONTROLLED_EXTENSION');
    expect(c).not.toContain('WASH_SUSPECTED');
  });
  it('the organic-volume ratio is only a sanity floor: SOL reports ~1.3 % organic on Jupiter', () => {
    expect(codes('SOL')).toEqual(['OK']);
    const strict = { ...DEFAULT_QUALITY_THRESHOLDS, minOrganicRatio: 0.2 };
    expect(evaluateAssetQuality(fx('SOL'), strict).status).toBe('WARNING');
  });
  it('a manipulated low-liquidity meme is REJECTED for many independent reasons', () => {
    const c = codes('RUGME (synthetic)');
    expect(status('RUGME (synthetic)')).toBe('REJECTED');
    for (const expected of [
      'NO_ORACLE',
      'LIQUIDITY_BELOW_MIN',
      'MARKET_TOO_YOUNG',
      'ORGANIC_SCORE_LOW',
      'NOT_VERIFIED',
      'FLAGGED_SUSPICIOUS',
      'WASH_FLAGGED',
    ] as const) {
      expect(c).toContain(expected);
    }
  });
  it('an unsupported Token-2022 extension is a hard rejection even with great liquidity', () => {
    const c = codes('FEEx (synthetic Token-2022 transfer fee)');
    expect(status('FEEx (synthetic Token-2022 transfer fee)')).toBe('REJECTED');
    expect(c).toContain('UNSUPPORTED_EXTENSION');
    expect(c.filter((x) => x !== 'UNSUPPORTED_EXTENSION' && x !== 'WASH_NOT_SCREENED')).toEqual([]);
  });
  it('a stale oracle / halted issuer is REJECTED', () => {
    const c = codes('STALEx (synthetic stale oracle)');
    expect(status('STALEx (synthetic stale oracle)')).toBe('REJECTED');
    expect(c).toContain('ORACLE_STALE');
    expect(c).toContain('ISSUER_HALTED');
    expect(c).toContain('WASH_NOT_SCREENED');
  });
});

describe('market quality — thresholds are configurable', () => {
  it('an active transfer hook is always rejected', () => {
    const v = evaluateAssetQuality({
      ...fx('SOL'),
      transferHookProgram: 'Hook111',
    });
    expect(v.status).toBe('REJECTED');
    expect(v.reasons[0]?.code).toBe('ACTIVE_TRANSFER_HOOK');
  });
  it('relaxing liquidity thresholds changes the verdict deterministically', () => {
    const relaxed = { ...DEFAULT_QUALITY_THRESHOLDS, washScoreWarn: 0.5 };
    expect(evaluateAssetQuality(fx('TSLAx'), relaxed).status).toBe('ELIGIBLE');
    const strict = { ...DEFAULT_QUALITY_THRESHOLDS, minLiquidityUsd: 2_000_000 };
    expect(evaluateAssetQuality(fx('BONK'), strict).status).toBe('REJECTED');
  });
  it('crypto assets never enter LastKnown/market-closed reasoning', () => {
    const v = evaluateAssetQuality({
      ...fx('BONK'),
      oracleAgeSecs: 30 * 3600,
    });
    expect(v.equityLike).toBe(false);
    expect(v.status).toBe('REJECTED');
    expect(v.reasons.map((r) => r.code)).toContain('ORACLE_STALE');
  });
  it('rejects malformed input via schema', () => {
    expect(() => evaluateAssetQuality({ ...fx('SOL'), liquidityUsd: -1 })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';

import {
  SEED_ASSETS,
  SEED_PAIRS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  findAsset,
  toArenaAssetSpec,
} from './assets';

describe('seed asset registry', () => {
  it('has the 13 seed assets with unique mints and symbols', () => {
    expect(SEED_ASSETS.map((a) => a.symbol).sort()).toEqual(
      [
        'AAPLx',
        'BONK',
        'DISx',
        'GLDx',
        'GMEx',
        'MSTRx',
        'NVDAx',
        'PENGU',
        'SOL',
        'SPYx',
        'TSLAx',
        'WBTC',
        'WIF',
      ].sort(),
    );
    expect(new Set(SEED_ASSETS.map((a) => a.mint)).size).toBe(SEED_ASSETS.length);
  });
  it('xStocks are Token-2022 ScaledUi with 8 decimals and RTH market-hours policy', () => {
    for (const a of SEED_ASSETS.filter((x) => x.isXStock)) {
      expect(a.tokenProgramId).toBe(TOKEN_2022_PROGRAM_ID);
      expect(a.decimals).toBe(8);
      expect(a.scaledUi).toBe(true);
      expect(a.marketHours).toBe('UsEquityRth');
      expect(a.extensions).toContain('ScaledUiAmount');
      expect(a.mint.startsWith('Xs')).toBe(true);
      expect(a.pythSymbol).toBe(`Equity.US.${a.underlying ?? ''}/USD`);
      expect(a.token2022Notes).not.toBeNull();
    }
  });
  it('crypto assets are legacy SPL with Always market hours', () => {
    for (const a of SEED_ASSETS.filter((x) => !x.isXStock)) {
      expect(a.tokenProgramId).toBe(TOKEN_PROGRAM_ID);
      expect(a.marketHours).toBe('Always');
      expect(a.scaledUi).toBe(false);
      expect(a.maxClosedStalenessSecs).toBe(0);
    }
  });
  it('every active asset has a 64-hex settlement feed and a provenance record', () => {
    for (const a of SEED_ASSETS) {
      expect(a.status).toBe('Active');
      expect(a.pythFeedId).toMatch(/^[0-9a-f]{64}$/);
      expect(a.provenance.sources.length).toBeGreaterThan(0);
      expect(a.provenance.verifiedAt).toBe('2026-09-12');
    }
  });
  it('records missing issuer oracle entries honestly (DISx none, GMEx Lazer-only)', () => {
    expect(findAsset('DISx')?.xstockPythFeedId).toBeNull();
    expect(findAsset('GMEx')?.xstockPythFeedId).toBeNull();
    expect(findAsset('TSLAx')?.xstockPythFeedId).toHaveLength(64);
  });
  it('BTC is represented by WBTC with its own Pyth feed and a documented reason', () => {
    const btc = findAsset('BTC');
    expect(btc?.symbol).toBe('WBTC');
    expect(btc?.pythSymbol).toBe('Crypto.WBTC/USD');
    expect(btc?.statusReason).toContain('cbBTC');
  });
  it('seed pairs resolve to two distinct active assets and build engine specs', () => {
    for (const [x, y] of SEED_PAIRS) {
      const a = findAsset(x);
      const b = findAsset(y);
      if (!a || !b) throw new Error(`missing ${x}/${y}`);
      expect(a.mint).not.toBe(b.mint);
      const sa = toArenaAssetSpec(a);
      const sb = toArenaAssetSpec(b);
      expect(sa.feedId).toBe(a.pythFeedId);
      expect(sb.toleranceSecs).toBe(BigInt(b.toleranceSecs));
    }
  });
});

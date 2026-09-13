import 'server-only';

import { findAsset } from '@tribe/core';

import type { ArenaView, MarketQuote, MarketStatus, SideMarket } from '../arena/model';
import { getJupiterIcon, getJupiterPrices } from './jupiter';
import { getPythMarketHours } from './pyth';
import { getXStockStatus } from './xstocks';

/**
 * Attach live mainnet market context to Arenas (prices, 24h move,
 * liquidity, market status) and fill missing logos. Never touches Arena
 * performance numbers: for demo Arenas those stay simulated and labelled.
 */
export async function withMarket(arenas: ArenaView[]): Promise<ArenaView[]> {
  const mints = arenas.flatMap((a) => a.sides.map((s) => s.asset.mint));
  const quotes = await getJupiterPrices(mints).catch(() => new Map<string, MarketQuote>());
  const statusCache = new Map<string, Promise<MarketStatus>>();
  const iconCache = new Map<string, Promise<string | null>>();

  const statusFor = (symbol: string): Promise<MarketStatus> => {
    let p = statusCache.get(symbol);
    if (!p) {
      p = marketStatus(symbol);
      statusCache.set(symbol, p);
    }
    return p;
  };
  const iconFor = (mint: string): Promise<string | null> => {
    let p = iconCache.get(mint);
    if (!p) {
      p = getJupiterIcon(mint).catch(() => null);
      iconCache.set(mint, p);
    }
    return p;
  };

  return Promise.all(
    arenas.map(async (a) => {
      const sides = await Promise.all(
        a.sides.map(async (s) => {
          const quote = quotes.get(s.asset.mint) ?? unavailable(s.asset.mint);
          const status = await statusFor(s.asset.symbol);
          const logoUrl = s.asset.logoUrl ?? (await iconFor(s.asset.mint));
          const market: SideMarket = { quote, status };
          return { side: { ...s, asset: { ...s.asset, logoUrl } }, market };
        }),
      );
      const [x, y] = sides;
      if (!x || !y) return a;
      return {
        ...a,
        sides: [x.side, y.side] as ArenaView['sides'],
        market: [x.market, y.market] as ArenaView['market'],
      };
    }),
  );
}

function unavailable(mint: string): MarketQuote {
  return {
    mint,
    usdPrice: null,
    change24hPct: null,
    liquidityUsd: null,
    source: 'unavailable',
    fetchedAt: Date.now(),
    state: 'unavailable',
  };
}

export async function marketStatus(symbol: string): Promise<MarketStatus> {
  const asset = findAsset(symbol);
  if (!asset) return { state: 'unknown', source: 'unavailable', oracle: 'Pyth' };
  const oracle = `Pyth ${asset.pythSymbol ?? ''}`.trim();
  if (asset.marketHours === 'Always') return { state: 'open', source: 'always', oracle };
  if (asset.isXStock) {
    const s = await getXStockStatus(symbol).catch(() => null);
    if (s && s.source !== 'unavailable') return { ...s, oracle: `${oracle} × on-chain multiplier` };
  }
  if (asset.pythFeedId) {
    const h = await getPythMarketHours(asset.pythFeedId, 'equity').catch(() => null);
    if (h) {
      const st: MarketStatus = { state: h.isOpen ? 'open' : 'closed', source: 'pyth', oracle };
      const next = h.isOpen ? h.nextClose : h.nextOpen;
      if (next) st.nextChangeAt = next;
      return st;
    }
  }
  return { state: 'unknown', source: 'unavailable', oracle };
}

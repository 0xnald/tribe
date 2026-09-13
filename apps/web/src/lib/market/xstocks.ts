import 'server-only';

import type { MarketStatus } from '../arena/model';
import { cached } from './cache';

/** xStocks public API — trading status per symbol (no auth). */
const XS = process.env['XSTOCKS_API_URL'] ?? 'https://api.xstocks.fi/api/v2';

interface XsAsset {
  symbol: string;
  logo?: string;
  isTradingHalted?: boolean;
  trading?: {
    currentPeriod?: 'market' | 'extended' | 'overnight' | 'closed';
    openNow?: boolean;
    nextChangeAt?: string;
    isTradingHalted?: boolean;
    exchange?: { abbreviation?: string; name?: string };
  };
}

export async function getXStockStatus(symbol: string): Promise<MarketStatus> {
  const res = await cached(`xs:asset:${symbol}`, 60_000, async () => {
    const r = await fetch(`${XS}/public/assets/${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`xstocks ${r.status}`);
    return (await r.json()) as XsAsset;
  });
  if (!res) return { state: 'unknown', source: 'unavailable', oracle: 'Pyth' };
  const t = res.value.trading;
  const halted = res.value.isTradingHalted || t?.isTradingHalted;
  const status: MarketStatus = {
    state: halted ? 'halted' : t?.openNow ? 'open' : 'closed',
    source: 'xstocks',
    oracle: 'Pyth',
  };
  if (t?.currentPeriod) status.period = t.currentPeriod;
  if (t?.nextChangeAt) status.nextChangeAt = Math.floor(Date.parse(t.nextChangeAt) / 1000);
  if (t?.exchange?.abbreviation) status.exchange = t.exchange.abbreviation;
  return status;
}

import 'server-only';

import { cached } from './cache';

/**
 * Pyth — feed metadata (market hours) is public; price updates require a
 * Hermes API key (`PYTH_HERMES_API_KEY`) and are only used when configured.
 */
const HERMES = process.env['PYTH_HERMES_URL'] ?? 'https://pyth.dourolabs.app/hermes';
const PUBLIC_HERMES = 'https://hermes.pyth.network';

interface FeedMeta {
  id: string;
  market_hours?: { is_open?: boolean; next_open?: number | null; next_close?: number | null };
}

export interface PythMarketHours {
  isOpen: boolean;
  nextOpen: number | null;
  nextClose: number | null;
}

export async function getPythMarketHours(
  feedId: string,
  assetType: 'equity' | 'crypto',
): Promise<PythMarketHours | null> {
  const res = await cached(`pyth:hours:${assetType}`, 5 * 60_000, async () => {
    const r = await fetch(`${PUBLIC_HERMES}/v2/price_feeds?asset_type=${assetType}`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`pyth feeds ${r.status}`);
    const rows = (await r.json()) as FeedMeta[];
    const m = new Map<string, PythMarketHours>();
    for (const f of rows) {
      m.set(f.id, {
        isOpen: !!f.market_hours?.is_open,
        nextOpen: f.market_hours?.next_open ?? null,
        nextClose: f.market_hours?.next_close ?? null,
      });
    }
    return m;
  });
  return res?.value.get(feedId) ?? null;
}

export interface PythPrice {
  feedId: string;
  price: number;
  conf: number;
  publishTime: number;
}

interface LatestResponse {
  parsed?: Array<{
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }>;
}

/** Latest Hermes prices (only when an API key is configured). */
export async function getPythLatest(feedIds: string[]): Promise<Map<string, PythPrice> | null> {
  const key = process.env['PYTH_HERMES_API_KEY'];
  if (!key || feedIds.length === 0) return null;
  const res = await cached(`pyth:latest:${feedIds.join(',')}`, 10_000, async () => {
    const q = feedIds.map((id) => `ids[]=${id}`).join('&');
    const r = await fetch(`${HERMES}/v2/updates/price/latest?${q}&parsed=true`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`hermes ${r.status}`);
    const j = (await r.json()) as LatestResponse;
    const m = new Map<string, PythPrice>();
    for (const p of j.parsed ?? []) {
      m.set(p.id, {
        feedId: p.id,
        price: Number(p.price.price) * 10 ** p.price.expo,
        conf: Number(p.price.conf) * 10 ** p.price.expo,
        publishTime: p.price.publish_time,
      });
    }
    return m;
  });
  return res?.value ?? null;
}

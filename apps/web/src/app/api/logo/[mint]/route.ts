import { SEED_ASSETS } from '@tribe/core';
import { NextResponse } from 'next/server';

import { getJupiterIcon } from '@/lib/market/jupiter';

export const dynamic = 'force-dynamic';

/**
 * Logo proxy: registry logo (xStocks metadata, BONK arweave) or the Jupiter
 * token icon, fetched once server-side and cached, so asset identities
 * never depend on a third-party gateway answering every viewer.
 */
const cache = new Map<string, { body: ArrayBuffer; type: string; at: number }>();
const TTL = 24 * 3600_000;

export async function GET(_req: Request, ctx: RouteContext<'/api/logo/[mint]'>) {
  const { mint } = await ctx.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return new NextResponse(null, { status: 400 });
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < TTL) return respond(hit.body, hit.type);
  const reg = SEED_ASSETS.find((a) => a.mint === mint);
  // candidates in order: registry logo, Jupiter token icon, the public token-list mirror
  const candidates = [
    reg?.visual.logoUrl ?? null,
    await getJupiterIcon(mint).catch(() => null),
    `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${mint}/logo.png`,
  ].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  for (const url of candidates) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') ?? 'image/png';
      if (!type.startsWith('image/')) continue;
      const body = await r.arrayBuffer();
      cache.set(mint, { body, type, at: Date.now() });
      return respond(body, type);
    } catch {
      /* try the next source */
    }
  }
  return new NextResponse(null, { status: 404 });
}

function respond(body: ArrayBuffer, type: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}

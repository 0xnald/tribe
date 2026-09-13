import { NextResponse } from 'next/server';

import { getJupiterQuote } from '@/lib/market/jupiter';

export const dynamic = 'force-dynamic';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Indicative mainnet Jupiter quote: USDC → asset. Never executed from here. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const out = u.searchParams.get('out');
  const amount = u.searchParams.get('amount'); // micro-USDC
  if (!out || !amount || !/^\d+$/.test(amount))
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  try {
    const q = await getJupiterQuote(USDC, out, BigInt(amount));
    if (!q)
      return NextResponse.json(
        { data: null, reason: 'unavailable' },
        { headers: { 'cache-control': 'no-store' } },
      );
    return NextResponse.json({ data: q }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { data: null, reason: 'unavailable' },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
}

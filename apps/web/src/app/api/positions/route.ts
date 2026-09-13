import { NextResponse } from 'next/server';

import { listDevnetPositions } from '@/lib/protocol/service';

export const dynamic = 'force-dynamic';

/** Real on-chain positions for a wallet on the protocol cluster. */
export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner');
  if (!owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
  try {
    const data = await listDevnetPositions(owner);
    return NextResponse.json(
      { data, now: Math.floor(Date.now() / 1000) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unavailable' },
      { status: 502 },
    );
  }
}

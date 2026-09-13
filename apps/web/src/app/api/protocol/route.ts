import { NextResponse } from 'next/server';

import { getProtocolStatus } from '@/lib/protocol/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getProtocolStatus();
  return NextResponse.json(
    { data, now: Math.floor(Date.now() / 1000) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

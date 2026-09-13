import { NextResponse } from 'next/server';

import { listArenas } from '@/lib/arena/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = Math.floor(Date.now() / 1000);
  const data = await listArenas(now);
  return NextResponse.json({ data, now }, { headers: { 'cache-control': 'no-store' } });
}

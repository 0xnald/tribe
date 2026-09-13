import { NextResponse } from 'next/server';

import { getArena } from '@/lib/arena/repo';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/arenas/[slug]'>) {
  const { slug } = await ctx.params;
  const now = Math.floor(Date.now() / 1000);
  const data = await getArena(slug, now);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data, now }, { headers: { 'cache-control': 'no-store' } });
}

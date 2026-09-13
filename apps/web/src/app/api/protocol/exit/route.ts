import { NextResponse } from 'next/server';

import { buildExitTransaction } from '@/lib/protocol/tx';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { owner?: string; arena?: string; side?: 'a' | 'b'; units?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.owner || !body.arena || (body.side !== 'a' && body.side !== 'b'))
    return NextResponse.json({ error: 'owner, arena, side required' }, { status: 400 });
  try {
    return NextResponse.json(
      await buildExitTransaction(body.owner, body.arena, body.side, body.units),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to build' },
      { status: 400 },
    );
  }
}

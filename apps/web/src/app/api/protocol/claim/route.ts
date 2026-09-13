import { NextResponse } from 'next/server';

import { buildClaimTransaction } from '@/lib/protocol/tx';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { owner?: string; arena?: string; side?: 'a' | 'b' };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.owner || !body.arena || (body.side !== 'a' && body.side !== 'b'))
    return NextResponse.json({ error: 'owner, arena, side required' }, { status: 400 });
  try {
    return NextResponse.json(await buildClaimTransaction(body.owner, body.arena, body.side), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to build' },
      { status: 400 },
    );
  }
}

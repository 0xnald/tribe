import { NextResponse } from 'next/server';

import { buildBackTransaction } from '@/lib/protocol/tx';

export const dynamic = 'force-dynamic';

/**
 * Builds an unsigned `open_position + back` transaction for the protocol
 * cluster. The wallet signs client-side; nothing here can move funds.
 */
export async function POST(req: Request) {
  let body: { owner?: string; arena?: string; side?: 'a' | 'b'; units?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (
    !body.owner ||
    !body.arena ||
    (body.side !== 'a' && body.side !== 'b') ||
    typeof body.units !== 'number' ||
    !(body.units > 0)
  ) {
    return NextResponse.json(
      { error: 'owner, arena, side and units are required' },
      { status: 400 },
    );
  }
  try {
    const out = await buildBackTransaction(body.owner, body.arena, body.side, body.units);
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to build' },
      { status: 400 },
    );
  }
}

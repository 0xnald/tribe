import { NextResponse } from 'next/server';

import { dripDevnetTokens, faucetAvailable } from '@/lib/protocol/faucet';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { available: faucetAvailable() },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/** Mint devnet stand-in tokens to `owner`. Devnet only; rate-limited per address in memory. */
const last = new Map<string, number>();

export async function POST(req: Request) {
  let body: { owner?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
  if (!faucetAvailable())
    return NextResponse.json({ error: 'faucet not available' }, { status: 503 });
  const t = last.get(body.owner) ?? 0;
  if (Date.now() - t < 60_000)
    return NextResponse.json({ error: 'try again in a minute' }, { status: 429 });
  last.set(body.owner, Date.now());
  try {
    return NextResponse.json(await dripDevnetTokens(body.owner), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    last.delete(body.owner);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'faucet failed' },
      { status: 400 },
    );
  }
}

import { NextResponse } from 'next/server';

import { buildJupiterSwap } from '@/lib/market/jupiter';

export const dynamic = 'force-dynamic';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Transaction 1 of the two-step USDC → asset → Back flow: a Jupiter-built
 * swap for the connected wallet (mainnet). Never executed here; the wallet
 * signs after the client verifies the intent.
 */
export async function POST(req: Request) {
  let body: { owner?: string; outputMint?: string; amount?: string; slippageBps?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const { owner, outputMint, amount } = body;
  if (!owner || !PUBKEY.test(owner) || !outputMint || !PUBKEY.test(outputMint)) {
    return NextResponse.json({ error: 'owner and outputMint required' }, { status: 400 });
  }
  if (!amount || !/^\d{1,15}$/.test(amount) || BigInt(amount) <= 0n) {
    return NextResponse.json({ error: 'amount (micro-USDC) required' }, { status: 400 });
  }
  const slippageBps = Math.min(500, Math.max(10, Math.floor(body.slippageBps ?? 50)));
  try {
    const out = await buildJupiterSwap(USDC, outputMint, BigInt(amount), owner, slippageBps);
    if (!out) return NextResponse.json({ error: 'no route' }, { status: 502 });
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'swap unavailable' },
      { status: 502 },
    );
  }
}

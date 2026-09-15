import 'server-only';

import type { MarketQuote } from '../arena/model';
import { cached } from './cache';

/**
 * Jupiter Price v3 — mainnet USD prices, 24h change and liquidity.
 * Keyless via lite-api; `JUPITER_API_KEY` switches to api.jup.ag.
 * Mints Jupiter omits are unreliable to price → `unavailable`, never
 * substituted with another number.
 */
const LITE = 'https://lite-api.jup.ag';
const PRO = 'https://api.jup.ag';

function base(): { url: string; headers: Record<string, string> } {
  const key = process.env['JUPITER_API_KEY'];
  return key ? { url: PRO, headers: { 'x-api-key': key } } : { url: LITE, headers: {} };
}

interface PriceV3Row {
  usdPrice?: number;
  priceChange24h?: number;
  liquidity?: number;
  decimals?: number;
}

export async function getJupiterPrices(mints: string[]): Promise<Map<string, MarketQuote>> {
  const ids = Array.from(new Set(mints)).sort();
  const out = new Map<string, MarketQuote>();
  if (ids.length === 0) return out;
  const res = await cached(`jup:price:${ids.join(',')}`, 15_000, async () => {
    const { url, headers } = base();
    const r = await fetch(`${url}/price/v3?ids=${ids.join(',')}`, {
      headers,
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`jupiter price ${r.status}`);
    return (await r.json()) as Record<string, PriceV3Row>;
  });
  const now = Date.now();
  for (const mint of ids) {
    const row = res?.value[mint];
    if (!res || !row || typeof row.usdPrice !== 'number') {
      out.set(mint, {
        mint,
        usdPrice: null,
        change24hPct: null,
        liquidityUsd: null,
        source: 'unavailable',
        fetchedAt: now,
        state: 'unavailable',
      });
      continue;
    }
    out.set(mint, {
      mint,
      usdPrice: row.usdPrice,
      change24hPct: typeof row.priceChange24h === 'number' ? row.priceChange24h : null,
      liquidityUsd: typeof row.liquidity === 'number' ? row.liquidity : null,
      source: 'jupiter',
      fetchedAt: res.fetchedAt,
      state: res.stale ? 'stale' : 'ok',
    });
  }
  return out;
}

interface TokenV2Row {
  id: string;
  icon?: string;
}

/** Token icon URL from Jupiter Tokens v2 (long TTL; registry logos take precedence). */
export async function getJupiterIcon(mint: string): Promise<string | null> {
  const res = await cached(`jup:icon:${mint}`, 6 * 3_600_000, async () => {
    const { url, headers } = base();
    const r = await fetch(`${url}/tokens/v2/search?query=${mint}`, {
      headers,
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`jupiter tokens ${r.status}`);
    const rows = (await r.json()) as TokenV2Row[];
    return rows.find((t) => t.id === mint)?.icon ?? null;
  });
  return res?.value ?? null;
}

export interface JupiterOrderQuote {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  slippageBps: number;
  routeLabel: string;
  source: 'jupiter';
}

interface OrderResponse {
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string | number;
  slippageBps?: number;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
}

/**
 * Indicative USDC→asset quote. With an API key: `swap/v2/order` without a
 * taker (api.jup.ag). Keyless: lite-api `swap/v1/quote` (deprecated but
 * open) — same fields for what the preview needs. Mainnet only.
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
): Promise<JupiterOrderQuote | null> {
  const { url, headers } = base();
  const keyed = url === PRO;
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: '50',
  });
  const path = keyed ? '/swap/v2/order' : '/swap/v1/quote';
  const r = await fetch(`${url}${path}?${q.toString()}`, {
    headers,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const j = (await r.json()) as OrderResponse;
  if (!j.outAmount || !j.inAmount) return null;
  const labels = (j.routePlan ?? []).map((p) => p.swapInfo?.label).filter((l): l is string => !!l);
  return {
    inAmount: j.inAmount,
    outAmount: j.outAmount,
    otherAmountThreshold: j.otherAmountThreshold ?? j.outAmount,
    priceImpactPct: Number(j.priceImpactPct ?? 0),
    slippageBps: j.slippageBps ?? 50,
    routeLabel: labels.length ? Array.from(new Set(labels)).join(' → ') : 'Jupiter',
    source: 'jupiter',
  };
}

export interface JupiterSwapBuild {
  /** base64 VersionedTransaction built by Jupiter for `owner`. */
  swapTransaction: string;
  lastValidBlockHeight: number;
  quote: JupiterOrderQuote;
  prioritizationFeeLamports: number;
}

interface SwapResponse {
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  simulationError?: { error?: string } | null;
}

/**
 * Quote + build a swap transaction for `owner` (keyless lite-api
 * `swap/v1/quote` + `swap/v1/swap`, or the keyed v2 order flow when
 * JUPITER_API_KEY is set). Mainnet only. The caller verifies intent before
 * the wallet signs; the output units are re-read from the chain after
 * confirmation and never trusted from the quote.
 */
export async function buildJupiterSwap(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  owner: string,
  slippageBps = 50,
): Promise<JupiterSwapBuild | null> {
  const { url, headers } = base();
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(slippageBps),
  });
  const qr = await fetch(`${url}/swap/v1/quote?${q.toString()}`, {
    headers,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!qr.ok) return null;
  const quoteJson = (await qr.json()) as OrderResponse & Record<string, unknown>;
  if (!quoteJson.outAmount || !quoteJson.inAmount) return null;
  const sr = await fetch(`${url}/swap/v1/swap`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteJson,
      userPublicKey: owner,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!sr.ok) return null;
  const s = (await sr.json()) as SwapResponse;
  if (!s.swapTransaction) return null;
  const labels = (quoteJson.routePlan ?? [])
    .map((p) => p.swapInfo?.label)
    .filter((l): l is string => !!l);
  return {
    swapTransaction: s.swapTransaction,
    lastValidBlockHeight: s.lastValidBlockHeight ?? 0,
    prioritizationFeeLamports: s.prioritizationFeeLamports ?? 0,
    quote: {
      inAmount: quoteJson.inAmount,
      outAmount: quoteJson.outAmount,
      otherAmountThreshold: quoteJson.otherAmountThreshold ?? quoteJson.outAmount,
      priceImpactPct: Number(quoteJson.priceImpactPct ?? 0),
      slippageBps: quoteJson.slippageBps ?? slippageBps,
      routeLabel: labels.length ? Array.from(new Set(labels)).join(' → ') : 'Jupiter',
      source: 'jupiter',
    },
  };
}

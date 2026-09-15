'use client';

import { Connection, PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';

import { getNetworkConfig, type Cluster } from '@/lib/config/network';

export interface TokenBalance {
  state: 'idle' | 'loading' | 'ok' | 'error';
  /** Whole-token amount (ui amount). */
  amount: number;
  cluster: Cluster;
}

const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const NATIVE_MINT_STR = 'So11111111111111111111111111111111111111112';
/** SOL kept back for fees/rent when the native balance counts toward a wSOL position. */
const SOL_FEE_RESERVE = 0.02;
const conns = new Map<string, Connection>();
function connFor(url: string): Connection {
  let c = conns.get(url);
  if (!c) {
    c = new Connection(url, 'confirmed');
    conns.set(url, c);
  }
  return c;
}

interface Loaded {
  key: string;
  state: 'ok' | 'error';
  amount: number;
}

/**
 * Wallet balance of one mint on a chosen layer (`market` = mainnet, where
 * the real assets live; `protocol` = the cluster the Tribe program runs on).
 * Sums every token account for the mint (legacy + Token-2022).
 */
export function useTokenBalance(
  layer: 'market' | 'protocol',
  mint: string | null,
  owner: string | null,
  /** Bump to force a refetch (e.g. after a faucet drip). */
  refresh = 0,
): TokenBalance {
  const cfg = getNetworkConfig();
  const net = cfg[layer];
  const key = mint && owner ? `${net.rpcUrl}|${mint}|${owner}|${refresh}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !mint || !owner) return;
    let alive = true;
    (async () => {
      try {
        const c = connFor(net.rpcUrl);
        const o = new PublicKey(owner);
        const m = new PublicKey(mint);
        const [legacy, t22] = await Promise.all([
          c.getParsedTokenAccountsByOwner(o, { mint: m }),
          c
            .getParsedTokenAccountsByOwner(o, { mint: m, programId: TOKEN_2022 })
            .catch(() => ({ value: [] })),
        ]);
        let total = 0;
        if (mint === NATIVE_MINT_STR) {
          // native SOL is wrapped on demand by the Back transaction
          const lamports = await c.getBalance(o);
          total += Math.max(0, lamports / 1e9 - SOL_FEE_RESERVE);
        }
        for (const acc of [...legacy.value, ...t22.value]) {
          const info = acc.account.data as {
            parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } };
          };
          total += info.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        }
        if (alive) setLoaded({ key, state: 'ok', amount: total });
      } catch {
        if (alive) setLoaded({ key, state: 'error', amount: 0 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, mint, owner, net.rpcUrl]);

  if (!key) return { state: 'idle', amount: 0, cluster: net.cluster };
  if (loaded && loaded.key === key)
    return { state: loaded.state, amount: loaded.amount, cluster: net.cluster };
  return { state: 'loading', amount: 0, cluster: net.cluster };
}

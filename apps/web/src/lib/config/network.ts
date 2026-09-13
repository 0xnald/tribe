/**
 * Network configuration — the market layer and the protocol layer are
 * separately configurable (ARCHITECTURE §1, README "hybrid architecture").
 *
 *   market   : where prices, logos, liquidity and wallet balances come from
 *              (mainnet-beta during the hackathon; xStocks only exist there)
 *   protocol : where the tribe_arena program lives (devnet during Phase 3;
 *              flip TRIBE_PROTOCOL_CLUSTER=mainnet-beta + program id later)
 *
 * Nothing else in the app may hard-code a cluster name.
 */
export type Cluster = 'mainnet-beta' | 'devnet' | 'localnet';

export interface NetworkConfig {
  market: { cluster: Cluster; rpcUrl: string };
  protocol: {
    cluster: Cluster;
    rpcUrl: string;
    programId: string;
    /** Explorer cluster query param ('' for mainnet). */
    explorerCluster: string;
  };
  appUrl: string;
  /** `demo` renders fixtures only; `live` also reads mainnet market data. */
  mode: 'live' | 'demo';
}

const DEFAULT_PROGRAM_ID = 'shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4';

function cluster(v: string | undefined, fallback: Cluster): Cluster {
  return v === 'mainnet-beta' || v === 'devnet' || v === 'localnet' ? v : fallback;
}

function defaultRpc(c: Cluster): string {
  switch (c) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'localnet':
      return 'http://127.0.0.1:8899';
  }
}

/** Public (NEXT_PUBLIC_*) values are inlined at build time; safe on the client. */
export function getNetworkConfig(): NetworkConfig {
  const marketCluster = cluster(process.env['NEXT_PUBLIC_MARKET_CLUSTER'], 'mainnet-beta');
  const protocolCluster = cluster(process.env['NEXT_PUBLIC_TRIBE_PROTOCOL_CLUSTER'], 'devnet');
  return {
    market: {
      cluster: marketCluster,
      rpcUrl: process.env['NEXT_PUBLIC_MARKET_RPC_URL'] ?? defaultRpc(marketCluster),
    },
    protocol: {
      cluster: protocolCluster,
      rpcUrl: process.env['NEXT_PUBLIC_TRIBE_PROTOCOL_RPC_URL'] ?? defaultRpc(protocolCluster),
      programId: process.env['NEXT_PUBLIC_TRIBE_PROGRAM_ID'] ?? DEFAULT_PROGRAM_ID,
      explorerCluster: protocolCluster === 'mainnet-beta' ? '' : protocolCluster,
    },
    appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
    mode: process.env['NEXT_PUBLIC_TRIBE_MODE'] === 'demo' ? 'demo' : 'live',
  };
}

export function explorerAddressUrl(address: string, c = getNetworkConfig().protocol): string {
  const q = c.explorerCluster ? `?cluster=${c.explorerCluster}` : '';
  return `https://explorer.solana.com/address/${address}${q}`;
}

export function explorerTxUrl(sig: string, c = getNetworkConfig().protocol): string {
  const q = c.explorerCluster ? `?cluster=${c.explorerCluster}` : '';
  return `https://explorer.solana.com/tx/${sig}${q}`;
}

/** Short human label used by the provenance status pill. */
export function networkLabel(cfg = getNetworkConfig()): string {
  const m =
    cfg.market.cluster === 'mainnet-beta'
      ? 'LIVE MARKETS'
      : `${cfg.market.cluster.toUpperCase()} MARKETS`;
  const p = `${cfg.protocol.cluster === 'mainnet-beta' ? 'MAINNET' : cfg.protocol.cluster.toUpperCase()} PROTOCOL`;
  return `${m} · ${p}`;
}

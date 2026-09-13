'use client';

import { getNetworkConfig } from '@/lib/config/network';

import { Tooltip } from '../ui/Tooltip';

/**
 * `LIVE MARKETS · DEVNET PROTOCOL` — the one place the hybrid architecture
 * is explained. Compact pill with a tooltip; no banner.
 */
export function ProvenanceStatus({ className = '' }: { className?: string }) {
  const cfg = getNetworkConfig();
  const market =
    cfg.market.cluster === 'mainnet-beta'
      ? 'LIVE MARKETS'
      : `${cfg.market.cluster.toUpperCase()} MARKETS`;
  const proto = `${cfg.protocol.cluster === 'mainnet-beta' ? 'MAINNET' : cfg.protocol.cluster.toUpperCase()} PROTOCOL`;
  return (
    <Tooltip
      content={
        <div className="space-y-1.5">
          <p>
            <strong className="text-volt">Markets:</strong> prices, logos, liquidity and market
            hours come from Solana {cfg.market.cluster} (Jupiter, xStocks, Pyth).
          </p>
          <p>
            <strong className="text-[#9db3ff]">Protocol:</strong> the Tribe Arena program runs on{' '}
            {cfg.protocol.cluster}. Devnet Arenas use devnet test tokens — never your mainnet
            assets.
          </p>
          <p className="text-fg-muted">Demo Arenas are simulated and marked DEMO.</p>
        </div>
      }
    >
      <button
        type="button"
        className={`micro inline-flex h-7 items-center gap-2 rounded-full border border-line px-2.5 text-fg-muted hover:border-line-strong hover:text-fg ${className}`}
        aria-label={`${market}, ${proto}. Open for details.`}
      >
        <span className="live-dot" aria-hidden />
        <span className="hidden sm:inline">{market}</span>
        <span className="hidden sm:inline text-fg-faint">·</span>
        <span>{proto}</span>
      </button>
    </Tooltip>
  );
}

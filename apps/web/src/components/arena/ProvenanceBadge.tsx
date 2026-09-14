'use client';

import { provenanceHelp, provenanceLabel, type Provenance } from '@/lib/arena/model';
import { getNetworkConfig } from '@/lib/config/network';

import { Tooltip } from '../ui/Tooltip';

/**
 * Compact provenance marker (DESIGN_SYSTEM §6.1). Required on every Arena
 * surface and every position. LIVE = mainnet market data; MAINNET / DEVNET =
 * real state on the Tribe program (label follows the protocol cluster);
 * DEMO = fixture.
 */
export function ProvenanceBadge({
  provenance,
  className = '',
  detail,
}: {
  provenance: Provenance;
  className?: string;
  detail?: string;
}) {
  const cluster = getNetworkConfig().protocol.cluster;
  const styles: Record<Provenance, string> = {
    live: 'border-transparent bg-[color-mix(in_oklab,var(--volt)_18%,transparent)] text-volt-fg',
    onchain:
      'border-transparent bg-[color-mix(in_oklab,var(--ultra)_22%,transparent)] text-devnet-fg',
    demo: 'border-line-strong border-dashed text-fg-muted',
  };
  const label = provenanceLabel(provenance, cluster);
  const help = detail ?? provenanceHelp(provenance, cluster);
  return (
    <Tooltip content={help}>
      <button
        type="button"
        className={`micro inline-flex h-6 items-center gap-1.5 rounded-full border px-2 ${styles[provenance]} ${className}`}
        aria-label={`${label} data: ${help}`}
      >
        {provenance === 'live' ? <span className="live-dot" aria-hidden /> : null}
        {label}
      </button>
    </Tooltip>
  );
}

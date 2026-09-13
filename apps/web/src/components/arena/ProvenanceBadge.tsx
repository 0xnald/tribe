'use client';

import { PROVENANCE_HELP, PROVENANCE_LABEL, type Provenance } from '@/lib/arena/model';

import { Tooltip } from '../ui/Tooltip';

/**
 * Compact provenance marker (DESIGN_SYSTEM §6.1). Required on every Arena
 * surface and every position. LIVE = mainnet market data; DEVNET = real
 * transaction on the devnet program; DEMO = fixture.
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
  const styles: Record<Provenance, string> = {
    live: 'border-transparent bg-[color-mix(in_oklab,var(--volt)_18%,transparent)] text-volt',
    devnet:
      'border-transparent bg-[color-mix(in_oklab,var(--ultra)_22%,transparent)] text-[#9db3ff]',
    demo: 'border-line-strong border-dashed text-fg-muted',
  };
  return (
    <Tooltip content={detail ?? PROVENANCE_HELP[provenance]}>
      <button
        type="button"
        className={`micro inline-flex h-6 items-center gap-1.5 rounded-full border px-2 ${styles[provenance]} ${className}`}
        aria-label={`${PROVENANCE_LABEL[provenance]} data: ${detail ?? PROVENANCE_HELP[provenance]}`}
      >
        {provenance === 'live' ? <span className="live-dot" aria-hidden /> : null}
        {PROVENANCE_LABEL[provenance]}
      </button>
    </Tooltip>
  );
}

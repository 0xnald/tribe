import { fmtPct } from '@/lib/format';

/**
 * Signed performance readout (DESIGN_SYSTEM §6.3). Colour is never the only
 * carrier: the sign and an arrow glyph travel with the number.
 */
export function PerfValue({
  pct,
  size = 'md',
  caption,
  className = '',
}: {
  pct: number;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  caption?: string;
  className?: string;
}) {
  const tone = pct > 0 ? 'text-rise' : pct < 0 ? 'text-fall' : 'text-fg-muted';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  const sz = {
    sm: 'text-sm',
    md: 'text-xl',
    lg: 'text-3xl md:text-4xl',
    hero: 'text-[44px] leading-none sm:text-[56px] lg:text-[80px]',
  }[size];
  const arrowSz = {
    sm: 'text-[10px]',
    md: 'text-xs',
    lg: 'text-base',
    hero: 'text-xl lg:text-3xl',
  }[size];
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className={`display tnum inline-flex items-baseline gap-1.5 font-bold ${sz} ${tone}`}>
        <span className={arrowSz} aria-hidden>
          {arrow}
        </span>
        <span>{fmtPct(pct)}</span>
      </span>
      {caption ? <span className="mt-1 text-xs text-fg-muted">{caption}</span> : null}
    </span>
  );
}

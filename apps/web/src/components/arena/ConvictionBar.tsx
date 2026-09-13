import type { ArenaSideView } from '@/lib/arena/model';
import { fmtMultiplier } from '@/lib/format';

/**
 * Backing split (DESIGN_SYSTEM §6.4). One bar, two asset hues, labels at
 * both ends, underdog multiplier tag on the smaller side. Width changes
 * animate (spring-like ease) and stop under reduced motion.
 */
export function ConvictionBar({
  a,
  b,
  height = 'md',
  showLabels = true,
  className = '',
}: {
  a: ArenaSideView;
  b: ArenaSideView;
  height?: 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  className?: string;
}) {
  const pctA = Math.round(a.backingShare * 100);
  const pctB = 100 - pctA;
  const h = { sm: 'h-2.5', md: 'h-3', lg: 'h-5' }[height];
  return (
    <div className={`w-full ${className}`}>
      {showLabels ? (
        <div className="mb-1.5 flex items-end justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span className="display text-lg font-bold">{pctA}%</span>
            <span className="text-fg-muted">{a.asset.symbol}</span>
            {a.multiplier > 1.005 ? <MultiplierTag m={a.multiplier} /> : null}
          </span>
          <span className="flex items-center gap-2">
            {b.multiplier > 1.005 ? <MultiplierTag m={b.multiplier} /> : null}
            <span className="text-fg-muted">{b.asset.symbol}</span>
            <span className="display text-lg font-bold">{pctB}%</span>
          </span>
        </div>
      ) : null}
      <div
        className={`flex w-full overflow-hidden rounded-full bg-bg-sunken ${h}`}
        role="img"
        aria-label={`Backing split: ${pctA}% ${a.asset.symbol}, ${pctB}% ${b.asset.symbol}`}
      >
        <div
          className="h-full rounded-l-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
          style={{ width: `${pctA}%`, background: a.asset.color }}
        />
        <div
          className="h-full flex-1 rounded-r-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
          style={{ background: b.asset.color }}
        />
      </div>
    </div>
  );
}

export function MultiplierTag({ m }: { m: number }) {
  return (
    <span className="micro inline-flex h-5 items-center rounded-full bg-[color-mix(in_oklab,var(--gold)_22%,transparent)] px-1.5 whitespace-nowrap text-gold">
      {fmtMultiplier(m)}
      <span className="hidden sm:inline">&nbsp;underdog</span>
    </span>
  );
}

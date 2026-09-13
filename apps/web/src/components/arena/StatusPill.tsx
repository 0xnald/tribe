import type { ArenaView } from '@/lib/arena/model';

/** Arena phase pill: LIVE (volt dot), BACKING CLOSED, SCHEDULED, SETTLING, SETTLED, CANCELLED. */
export function StatusPill({
  arena,
  now,
  className = '',
}: {
  arena: ArenaView;
  now: number;
  className?: string;
}) {
  const s = arena.status;
  const endingSoon = s === 'live' && arena.endTs - now < 3600;
  const map: Record<ArenaView['status'], { label: string; cls: string; dot?: boolean }> = {
    live: { label: 'LIVE', cls: 'text-volt-fg', dot: true },
    backing_closed: { label: 'LIVE · LOCKED', cls: 'text-volt-fg', dot: true },
    scheduled: { label: 'SCHEDULED', cls: 'text-fg-muted' },
    settling: { label: 'SETTLING', cls: 'text-gold-fg' },
    settled: { label: 'SETTLED', cls: 'text-fg-muted' },
    cancelled: { label: 'CANCELLED', cls: 'text-fall' },
  };
  const m = map[s];
  return (
    <span className={`micro inline-flex items-center gap-1.5 ${m.cls} ${className}`}>
      {m.dot ? <span className="live-dot" aria-hidden /> : null}
      {m.label}
      {endingSoon ? <span className="text-ember-fg">· ENDING SOON</span> : null}
    </span>
  );
}

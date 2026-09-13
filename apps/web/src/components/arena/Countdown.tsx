'use client';

import { useEffect, useRef, useState } from 'react';

import { arenaCountdown, type ArenaView } from '@/lib/arena/model';
import { fmtCountdown } from '@/lib/format';

/**
 * HH:MM:SS countdown (DESIGN_SYSTEM §6.5). Label follows the Arena phase;
 * the last 60 s tint Ember. Screen readers get a throttled polite update
 * (every 30 s) instead of every second.
 */
export function Countdown({
  arena,
  now,
  size = 'md',
  showLabel = true,
  className = '',
}: {
  arena: ArenaView;
  now: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}) {
  const { label, secs } = arenaCountdown(arena, now);
  const urgent = secs > 0 && secs <= 60 && arena.status === 'live';
  const sz = { sm: 'text-sm', md: 'text-lg', lg: 'text-2xl md:text-3xl' }[size];
  const done = secs <= 0;

  // throttled live region
  const [announced, setAnnounced] = useState('');
  const last = useRef(0);
  useEffect(() => {
    if (now - last.current >= 30) {
      last.current = now;
      setAnnounced(done ? label.toLowerCase() : `${label.toLowerCase()} ${fmtCountdown(secs)}`);
    }
  }, [now, secs, label, done]);

  return (
    <span className={`inline-flex flex-col ${className}`}>
      {showLabel ? <span className="micro text-fg-muted">{label}</span> : null}
      <span
        className={`tnum font-mono font-semibold tracking-tight ${sz} ${urgent ? 'text-ember-fg' : 'text-fg'}`}
        aria-hidden
      >
        {done ? '—' : fmtCountdown(secs)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </span>
  );
}

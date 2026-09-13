'use client';

import { useEffect, useRef, useState } from 'react';

import type { ArenaView } from '@/lib/arena/model';

export interface LiveState<T> {
  data: T;
  /** Unix seconds of the last successful refresh. */
  updatedAt: number;
  /** True when the last refresh failed; the data shown is the last good one. */
  stale: boolean;
  error: string | null;
}

/**
 * Polls a JSON endpoint while the tab is visible. Conservative cadence
 * (default 15 s) — the market layer is cached server-side anyway.
 */
export function useLive<T>(
  url: string,
  initial: T,
  initialAt: number,
  intervalMs = 15_000,
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({
    data: initial,
    updatedAt: initialAt,
    stale: false,
    error: null,
  });
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      try {
        const r = await fetch(urlRef.current, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { data: T; now: number };
        if (alive) setState({ data: j.data, updatedAt: j.now, stale: false, error: null });
      } catch (e) {
        if (alive)
          setState((s) => ({
            ...s,
            stale: true,
            error: e instanceof Error ? e.message : 'refresh failed',
          }));
      }
      schedule();
    };
    const schedule = () => {
      if (alive) timer = setTimeout(() => void tick(), intervalMs);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    schedule();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);

  return state;
}

export function useLiveArenas(initial: ArenaView[], initialAt: number): LiveState<ArenaView[]> {
  return useLive<ArenaView[]>('/api/arenas', initial, initialAt, 20_000);
}

export function useLiveArena(
  slug: string,
  initial: ArenaView,
  initialAt: number,
): LiveState<ArenaView> {
  return useLive<ArenaView>(`/api/arenas/${slug}`, initial, initialAt, 10_000);
}

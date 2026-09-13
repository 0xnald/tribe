'use client';

import { useEffect, useState } from 'react';

import { nowSecs } from '@/lib/time';

/**
 * Ticking unix clock (seconds). Starts from `initial` (the server's clock at
 * render time) so the first client render matches the server HTML, then
 * follows the device clock.
 */
export function useNow(initial?: number, intervalMs = 1000): number {
  const [now, setNow] = useState(() => initial ?? nowSecs());
  useEffect(() => {
    const tick = () => setNow(nowSecs());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

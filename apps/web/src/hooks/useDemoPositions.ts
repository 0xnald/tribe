'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { PositionRecord } from '@/lib/positions/model';

/**
 * Demo positions live in localStorage only (provenance `demo`, never a
 * transaction). Devnet positions are read from chain, not stored here.
 */
const KEY = 'tribe.demoPositions.v1';
const listeners = new Set<() => void>();
let cache: PositionRecord[] = [];
let cacheRaw: string | null | undefined; // undefined = never read
const EMPTY: PositionRecord[] = [];

/** Re-parses only when the stored string changed, so snapshots stay referentially stable. */
function read(): PositionRecord[] {
  let raw: string | null = null;
  try {
    raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
  } catch {
    return cache;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    cache = raw ? (JSON.parse(raw) as PositionRecord[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: PositionRecord[]): void {
  cache = next;
  cacheRaw = JSON.stringify(next);
  try {
    window.localStorage.setItem(KEY, cacheRaw);
  } catch {
    /* private mode etc. — keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

export function useDemoPositions() {
  const positions = useSyncExternalStore(subscribe, read, () => EMPTY);
  const add = useCallback((p: PositionRecord) => write([p, ...read()]), []);
  const update = useCallback((id: string, patch: Partial<PositionRecord>) => {
    write(read().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);
  const clear = useCallback(() => write([]), []);
  return { positions, add, update, clear };
}

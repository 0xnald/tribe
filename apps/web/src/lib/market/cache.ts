/**
 * Tiny in-memory TTL cache for third-party market calls (server only).
 * Serves stale values while a refresh is in flight so pages never block on
 * an upstream hiccup; callers receive `stale: true` once refreshes have
 * been failing for 3× the TTL, and `null` when nothing was ever loaded
 * (never a substitute).
 */
interface Entry<T> {
  value: T;
  fetchedAt: number;
  refreshing: Promise<void> | null;
}

const store = new Map<string, Entry<unknown>>();

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  opts: { maxStaleMs?: number } = {},
): Promise<Cached<T> | null> {
  const now = Date.now();
  const e = store.get(key) as Entry<T> | undefined;
  if (e && now - e.fetchedAt < ttlMs) {
    return { value: e.value, fetchedAt: e.fetchedAt, stale: false };
  }
  const refresh = async (): Promise<void> => {
    const value = await load();
    store.set(key, { value, fetchedAt: Date.now(), refreshing: null });
  };
  if (!e) {
    try {
      await refresh();
    } catch {
      return null;
    }
    const fresh = store.get(key) as Entry<T>;
    return { value: fresh.value, fetchedAt: fresh.fetchedAt, stale: false };
  }
  // stale-while-revalidate
  if (!e.refreshing) {
    e.refreshing = refresh()
      .catch(() => undefined)
      .finally(() => {
        const cur = store.get(key) as Entry<T> | undefined;
        if (cur) cur.refreshing = null;
      });
  }
  const maxStale = opts.maxStaleMs ?? ttlMs * 20;
  if (now - e.fetchedAt > maxStale) {
    await e.refreshing;
    const cur = store.get(key) as Entry<T>;
    return {
      value: cur.value,
      fetchedAt: cur.fetchedAt,
      stale: Date.now() - cur.fetchedAt >= ttlMs,
    };
  }
  return { value: e.value, fetchedAt: e.fetchedAt, stale: true };
}

export function clearMarketCache(): void {
  store.clear();
}

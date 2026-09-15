/**
 * Pending two-step Backs. When transaction 1 (Jupiter buy) confirmed but
 * transaction 2 (`back`) was cancelled or failed, the purchased asset is in
 * the user's wallet and must never be bought again. The record survives a
 * refresh so "Retry Back" is offered instead of a second buy.
 */
export interface PendingBack {
  arenaId: string;
  side: 'a' | 'b';
  mint: string;
  symbol: string;
  /** Whole-token units actually received (balance delta), the only amount Back may use. */
  receivedUnits: number;
  swapSig: string;
  usdcSpent: number;
  createdAt: number;
}

const KEY = 'tribe.pendingBack.v1';

function readAll(): PendingBack[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as PendingBack[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: PendingBack[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode — the in-flight flow still holds the record in memory */
  }
}

export function getPendingBack(arenaId: string, side: 'a' | 'b'): PendingBack | null {
  return readAll().find((p) => p.arenaId === arenaId && p.side === side) ?? null;
}

export function setPendingBack(p: PendingBack): void {
  writeAll([p, ...readAll().filter((x) => !(x.arenaId === p.arenaId && x.side === p.side))]);
}

export function clearPendingBack(arenaId: string, side: 'a' | 'b'): void {
  writeAll(readAll().filter((x) => !(x.arenaId === arenaId && x.side === side)));
}

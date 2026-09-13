/** Number formatting per DESIGN_SYSTEM §3: signed percentages with two decimals, grouped money. */

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat('en-US');

export function fmtPct(pct: number, digits = 2): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

export function fmtUsd(v: number, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (!Number.isFinite(v)) return '—';
  if (opts.compact) {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
    if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  }
  return opts.cents ? usd2.format(v) : usd0.format(v);
}

/** Token prices: adaptive precision so BONK ($0.0000276) and TSLAx ($365.25) both read well. */
export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return usd2.format(v);
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  // sub-cent: show 4 significant digits
  return `$${v.toPrecision(4).replace(/\.?0+$/, '')}`;
}

export function fmtInt(v: number): string {
  return int.format(Math.round(v));
}

/** Token amounts: up to 6 significant digits, grouped. */
export function fmtAmount(v: number, symbol?: string): string {
  if (!Number.isFinite(v)) return '—';
  let s: string;
  if (v >= 1_000_000) s = int.format(Math.round(v));
  else if (v >= 1000) s = v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  else s = Number(v.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  return symbol ? `${s} ${symbol}` : s;
}

export function fmtMultiplier(m: number): string {
  return `${m.toFixed(m >= 1.95 ? 1 : 2).replace(/\.?0+$/, '')}×`;
}

/** HH:MM:SS (or D:HH:MM:SS above a day) for countdowns. */
export function fmtCountdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** Compact relative duration: 1h 42m, 48m, 3d 2h. */
export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function shortAddress(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

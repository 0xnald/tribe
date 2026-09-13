'use client';

import { ChevronDown, Clock, Droplets, Gauge, Radio } from 'lucide-react';
import { useState } from 'react';

import type { ActivityItem, ArenaView, SideMarket } from '@/lib/arena/model';
import { fmtDuration, fmtMultiplier, fmtPct, fmtPrice, fmtTime, fmtUsd } from '@/lib/format';

import { ProvenanceBadge } from './ProvenanceBadge';

/* ───────────────────────── Reward summary ───────────────────────── */

export function RewardSummary({ arena, now }: { arena: ArenaView; now: number }) {
  const [open, setOpen] = useState(false);
  const [a, b] = arena.sides;
  const underdog = a.backingShare < b.backingShare ? a : b;
  const closesIn = arena.backingCloseTs - now;
  return (
    <section
      className="flex flex-col gap-4 rounded-[20px] border border-line bg-bg-elev p-5"
      aria-labelledby="rewards-heading"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="rewards-heading" className="display text-xl font-bold">
          Arena Rewards
        </h2>
        <span className="display tnum text-2xl font-extrabold text-gold">
          {fmtUsd(arena.rewardPoolUsd)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Row k="Sponsor pool" v={arena.sponsorUsd > 0 ? fmtUsd(arena.sponsorUsd) : '—'} />
        <Row k="From fees" v={fmtUsd(Math.max(0, arena.rewardPoolUsd - arena.sponsorUsd))} />
        <Row
          k="Underdog multiplier"
          v={`${fmtMultiplier(underdog.multiplier)} on ${underdog.asset.symbol}`}
          tone="gold"
        />
        <Row k="Backing closes" v={closesIn > 0 ? `in ${fmtDuration(closesIn)}` : 'closed'} />
      </dl>
      <p className="text-sm text-fg-muted">
        The winning side shares the pool. Your share grows with how much you back and how long you
        hold it. Backing the underdog counts up to 2× — the boost fades in over the first{' '}
        {fmtDuration(arena.warmupSecs)} of the Arena. Exiting before the end forfeits your reward
        weight; your asset always comes back to you.
      </p>
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start text-sm font-semibold text-volt"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        How rewards work{' '}
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-2 rounded-[14px] bg-bg-sunken p-4 text-sm text-fg-muted">
          <p>
            <strong className="text-fg">Weight.</strong> Every deposit accrues{' '}
            <span className="font-mono">units × seconds held × underdog multiplier</span> while the
            Arena runs.
          </p>
          <p>
            <strong className="text-fg">Payout.</strong> After settlement each winning position
            receives <span className="font-mono">pool × weight ÷ total winning weight</span>,
            floored to the micro-USDC. Nothing is capped, nothing is guaranteed.
          </p>
          <p>
            <strong className="text-fg">Upsets.</strong> If the side with less than half of the
            backing wins, an Upset Bonus from the protocol reserve is added to the pool.
          </p>
          <p>
            <strong className="text-fg">Draw.</strong> Within {(0.01).toFixed(2)}% is a draw: the
            pool rolls over, sponsors can withdraw.
          </p>
          <p>
            <strong className="text-fg">Principal.</strong> Losing principal never becomes winning
            principal. The Arena only decides who shares the reward pool.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'gold' }) {
  return (
    <div className="rounded-[12px] bg-bg-sunken px-3 py-2">
      <dt className="micro text-fg-muted">{k}</dt>
      <dd className={`tnum mt-0.5 font-semibold ${tone === 'gold' ? 'text-gold' : ''}`}>{v}</dd>
    </div>
  );
}

/* ───────────────────────── Market panel ───────────────────────── */

export function MarketPanel({ arena }: { arena: ArenaView }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-[20px] border border-line bg-bg-elev p-5"
      aria-labelledby="market-heading"
    >
      <div className="flex items-center justify-between">
        <h2 id="market-heading" className="display text-xl font-bold">
          Markets
        </h2>
        {arena.market ? (
          <ProvenanceBadge
            provenance="live"
            detail="Live mainnet market data via Jupiter, xStocks and Pyth. Arena performance uses Arena reference prices; these are current market prices for context."
          />
        ) : null}
      </div>
      {arena.provenance === 'demo' ? (
        <p className="text-xs text-fg-muted">
          Demo Arena performance is simulated. The market rows below are live mainnet data for
          context.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {arena.sides.map((s, i) => (
          <MarketRow
            key={s.key}
            symbol={s.asset.symbol}
            color={s.asset.color}
            market={arena.market?.[i] ?? null}
            isXStock={s.asset.isXStock}
          />
        ))}
      </div>
    </section>
  );
}

function MarketRow({
  symbol,
  color,
  market,
  isXStock,
}: {
  symbol: string;
  color: string;
  market: SideMarket | null;
  isXStock: boolean;
}) {
  const q = market?.quote;
  const st = market?.status;
  const unavailable = !q || q.state === 'unavailable';
  const marketLabel = !st
    ? 'unknown'
    : st.state === 'open'
      ? isXStock
        ? `open · ${st.period ?? 'market'}${st.exchange ? ` · ${st.exchange}` : ''}`
        : 'open 24/7'
      : st.state === 'halted'
        ? 'trading halted'
        : st.state === 'closed'
          ? `closed${st.nextChangeAt ? ` · opens ${fmtTime(st.nextChangeAt)}` : ''}`
          : 'unknown';
  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] bg-bg-sunken p-3 text-sm"
      style={{ ['--asset' as string]: color }}
    >
      <div className="flex items-center justify-between">
        <span className="display text-base font-bold">{symbol}</span>
        {unavailable ? (
          <span className="micro rounded-full border border-dashed border-line-strong px-2 py-0.5 text-fg-muted">
            price unavailable
          </span>
        ) : (
          <span className="tnum font-mono">
            {fmtPrice(q.usdPrice ?? 0)}
            {q.state === 'stale' ? <span className="ml-1 text-ember">·stale</span> : null}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs text-fg-muted">
        <div>
          <dt className="inline-flex items-center gap-1">
            <Gauge size={12} aria-hidden /> 24h
          </dt>
          <dd
            className={`tnum font-semibold ${!q || q.change24hPct === null ? '' : q.change24hPct >= 0 ? 'text-rise' : 'text-fall'}`}
          >
            {q && q.change24hPct !== null ? fmtPct(q.change24hPct) : '—'}
          </dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1">
            <Droplets size={12} aria-hidden /> Liquidity
          </dt>
          <dd className="tnum font-semibold text-fg">
            {q && q.liquidityUsd !== null ? fmtUsd(q.liquidityUsd, { compact: true }) : '—'}
          </dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden /> Market
          </dt>
          <dd
            className={`font-semibold ${st?.state === 'open' ? 'text-fg' : st?.state === 'halted' ? 'text-fall' : 'text-fg-muted'}`}
          >
            {marketLabel}
          </dd>
        </div>
      </dl>
      <div className="inline-flex items-center gap-1 text-[11px] text-fg-faint">
        <Radio size={11} aria-hidden /> Oracle: {st?.oracle ?? 'Pyth'} · Price:{' '}
        {q?.source === 'jupiter' ? 'Jupiter Price v3' : 'unavailable'}
      </div>
    </div>
  );
}

/* ───────────────────────── Activity ───────────────────────── */

export function ArenaActivity({
  arena,
  items,
  now,
}: {
  arena: ArenaView;
  items: ActivityItem[];
  now: number;
}) {
  const [a, b] = arena.sides;
  return (
    <section
      className="flex flex-col gap-3 rounded-[20px] border border-line bg-bg-elev p-5"
      aria-labelledby="activity-heading"
    >
      <div className="flex items-center justify-between">
        <h2 id="activity-heading" className="display text-xl font-bold">
          Activity
        </h2>
        {arena.provenance === 'demo' ? (
          <span className="micro rounded-full border border-dashed border-line-strong px-2 py-0.5 text-fg-muted">
            demo feed
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {arena.provenance === 'devnet'
            ? 'On-chain events will appear here once the indexer is wired (Phase 4).'
            : 'Nothing yet.'}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.slice(0, 12).map((it) => {
            const color =
              it.side === 'a'
                ? a.asset.color
                : it.side === 'b'
                  ? b.asset.color
                  : it.kind === 'sponsor'
                    ? 'var(--gold)'
                    : it.kind === 'lead'
                      ? 'var(--ember)'
                      : 'var(--fg-faint)';
            return (
              <li key={it.id} className="flex items-start gap-3 py-2 text-sm">
                <span
                  className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="flex-1">{it.text}</span>
                <span className="tnum shrink-0 text-xs text-fg-faint">
                  {fmtDuration(now - it.ts)} ago
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

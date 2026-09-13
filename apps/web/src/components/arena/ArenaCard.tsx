'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';

import { arenaCountdown, isBackable, type ArenaView } from '@/lib/arena/model';
import { fmtCountdown, fmtUsd } from '@/lib/format';
import { onAsset } from '@/lib/color';
import { useBackSheet } from '@/providers/Providers';

import { AssetLogo } from './AssetIdentity';
import { ConvictionBar } from './ConvictionBar';
import { PerfValue } from './PerfValue';
import { ProvenanceBadge } from './ProvenanceBadge';
import { StatusPill } from './StatusPill';

/**
 * Explore-grid Arena card (DESIGN_SYSTEM §6.6). The whole card links to the
 * Arena; the two Back buttons sit above the link layer. Featured cards get
 * a taller matchup and asset-tinted halves.
 */
export function ArenaCard({
  arena,
  now,
  variant = 'default',
}: {
  arena: ArenaView;
  now: number;
  variant?: 'default' | 'featured' | 'compact';
}) {
  const { openBack } = useBackSheet();
  const [a, b] = arena.sides;
  const cd = arenaCountdown(arena, now);
  const backable = isBackable(arena, now);
  const leader = arena.leader === 'a' ? a : arena.leader === 'b' ? b : null;
  const featured = variant === 'featured';
  const compact = variant === 'compact';

  return (
    <article
      className={`group relative isolate flex flex-col overflow-hidden rounded-[20px] border border-line bg-bg-elev transition-[border-color,transform] duration-[var(--dur-fast)] hover:border-line-strong ${
        featured ? 'md:col-span-2' : ''
      }`}
      data-testid="arena-card"
      data-slug={arena.slug}
      data-provenance={arena.provenance}
    >
      {/* asset-tinted halves */}
      <div className="pointer-events-none absolute inset-0 -z-10 flex" aria-hidden>
        <div
          className="flex-1"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${a.asset.color} 22%, transparent), transparent 60%)`,
          }}
        />
        <div
          className="flex-1"
          style={{
            background: `linear-gradient(225deg, color-mix(in oklab, ${b.asset.color} 22%, transparent), transparent 60%)`,
          }}
        />
      </div>

      <Link
        href={`/arena/${arena.slug}`}
        className="absolute inset-0 z-0 rounded-[20px]"
        aria-label={`${a.asset.symbol} vs ${b.asset.symbol} Arena`}
      />

      <div className="pointer-events-none relative z-10 flex flex-col gap-4 p-4 md:p-5">
        {/* status row */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <StatusPill arena={arena} now={now} />
            <span className="tnum font-mono text-fg-muted">
              {cd.secs > 0 ? fmtCountdown(cd.secs) : ''}
            </span>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="tnum hidden text-fg-muted sm:inline">
              {arena.totalBackingUsd > 0 ? fmtUsd(arena.totalBackingUsd, { compact: true }) : ''}
            </span>
            <ProvenanceBadge provenance={arena.provenance} />
          </div>
        </div>

        {/* matchup */}
        <div
          className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 ${featured ? 'py-2 md:py-4' : ''}`}
        >
          <Side side={a} big={featured} lead={arena.leader === 'a'} align="left" />
          <span
            className="display-tight text-fg-faint select-none text-2xl font-extrabold md:text-3xl"
            aria-hidden
          >
            VS
          </span>
          <Side side={b} big={featured} lead={arena.leader === 'b'} align="right" />
        </div>

        {arena.status !== 'scheduled' && arena.status !== 'cancelled' ? (
          <p className="micro text-center text-fg-muted">
            {leader ? (
              <>
                <span className="text-fg">{leader.asset.symbol} leads</span> by +
                {arena.leadPct.toFixed(2)}%
              </>
            ) : (
              'Dead even'
            )}
            {arena.status === 'settled' ? ' · settled' : ''}
          </p>
        ) : arena.status === 'scheduled' ? (
          <p className="micro text-center text-fg-muted">
            Opens {fmtCountdown(cd.secs)} · sponsor pool {fmtUsd(arena.sponsorUsd)}
          </p>
        ) : (
          <p className="micro text-center text-fg-muted">Cancelled · everything withdrawable</p>
        )}

        {!compact && arena.totalBackingUsd > 0 ? <ConvictionBar a={a} b={b} height="sm" /> : null}

        {!compact ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Users size={13} strokeWidth={1.75} aria-hidden />{' '}
              {arena.participants.toLocaleString('en-US')} backers
            </span>
            {arena.rewardPoolUsd > 0 ? (
              <span>
                Pool <span className="text-gold-fg">{fmtUsd(arena.rewardPoolUsd)}</span>
              </span>
            ) : null}
            <span className="ml-auto">{arena.narrative}</span>
          </div>
        ) : null}

        {!compact && backable ? (
          <div className="pointer-events-auto grid grid-cols-2 gap-2">
            <button
              type="button"
              className="asset-fill h-11 rounded-[12px] px-3 text-sm font-bold hover:brightness-95 active:scale-[0.98]"
              style={{ ['--asset' as string]: a.asset.color, color: onAsset(a.asset.color) }}
              onClick={() => openBack(arena, 'a')}
            >
              BACK {a.asset.symbol}
            </button>
            <button
              type="button"
              className="asset-fill h-11 rounded-[12px] px-3 text-sm font-bold hover:brightness-95 active:scale-[0.98]"
              style={{ ['--asset' as string]: b.asset.color, color: onAsset(b.asset.color) }}
              onClick={() => openBack(arena, 'b')}
            >
              BACK {b.asset.symbol}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Side({
  side,
  big,
  lead,
  align,
}: {
  side: ArenaView['sides'][number];
  big: boolean;
  lead: boolean;
  align: 'left' | 'right';
}) {
  const right = align === 'right';
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${right ? 'items-end text-right' : 'items-start text-left'}`}
      style={{ ['--asset' as string]: side.asset.color }}
    >
      <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
        <AssetLogo asset={side.asset} size={big ? 40 : 28} />
        <span
          className={`display truncate font-bold ${big ? 'text-2xl md:text-3xl' : 'text-lg md:text-xl'} ${lead ? 'lead-underline' : ''}`}
        >
          {side.asset.symbol}
        </span>
      </div>
      <PerfValue pct={side.perfPct} size={big ? 'lg' : 'md'} />
    </div>
  );
}

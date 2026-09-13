'use client';

import { Trophy, Users } from 'lucide-react';
import Link from 'next/link';

import { arenaCountdown, isBackable, sideOf, type ArenaView } from '@/lib/arena/model';
import { fmtCountdown, fmtMultiplier, fmtUsd } from '@/lib/format';
import { onAsset } from '@/lib/color';
import { useBackSheet } from '@/providers/Providers';

import { AssetLogo } from './AssetIdentity';
import { ConvictionBar } from './ConvictionBar';
import { Countdown } from './Countdown';
import { PerfValue } from './PerfValue';
import { ProvenanceBadge } from './ProvenanceBadge';
import { ShareArena } from './ShareArena';
import { StatusPill } from './StatusPill';

/**
 * Cinematic matchup (DESIGN_SYSTEM §6.7): two asset-tinted halves, VS mark,
 * hero-size performance, lead line, conviction bar, stats, dual CTA. Used
 * on the homepage (featured, links through) and on the Arena page.
 */
export function ArenaHero({
  arena,
  now,
  linkTo = false,
}: {
  arena: ArenaView;
  now: number;
  linkTo?: boolean;
}) {
  const { openBack } = useBackSheet();
  const [a, b] = arena.sides;
  const backable = isBackable(arena, now);
  const leader = arena.leader === 'tie' ? null : sideOf(arena, arena.leader);
  const cd = arenaCountdown(arena, now);
  const finished =
    arena.status === 'settled' || arena.status === 'cancelled' || arena.status === 'settling';

  const title = (
    <h2 className="sr-only">
      {a.asset.symbol} vs {b.asset.symbol}
    </h2>
  );

  return (
    <section
      className="relative isolate overflow-hidden rounded-[24px] border border-line bg-bg-elev"
      aria-labelledby={`hero-${arena.slug}`}
      data-testid="arena-hero"
    >
      {/* tinted stage */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 w-1/2"
          style={{
            background: `radial-gradient(120% 90% at 0% 40%, color-mix(in oklab, ${a.asset.color} 34%, transparent), transparent 70%)`,
          }}
        />
        <div
          className="absolute inset-y-0 right-0 w-1/2"
          style={{
            background: `radial-gradient(120% 90% at 100% 40%, color-mix(in oklab, ${b.asset.color} 34%, transparent), transparent 70%)`,
          }}
        />
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-6 md:gap-7 md:p-8">
        {/* top row */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill arena={arena} now={now} />
          <span className="text-fg-faint">·</span>
          <span className="text-fg-muted">{arena.narrative}</span>
          <div className="ml-auto flex items-center gap-2">
            <ProvenanceBadge provenance={arena.provenance} />
            <ShareArena arena={arena} compact />
          </div>
        </div>

        {title}
        <span id={`hero-${arena.slug}`} className="sr-only">
          {a.asset.symbol} versus {b.asset.symbol}
        </span>

        {/* matchup */}
        <div className="relative grid grid-cols-2 items-start gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-6">
          <HeroSide
            side={a}
            align="left"
            lead={arena.leader === 'a'}
            winner={arena.winner === 'a'}
          />
          <div className="hidden flex-col items-center sm:flex">
            <span
              className="display-tight text-fg-faint select-none text-5xl font-black md:text-7xl"
              aria-hidden
            >
              VS
            </span>
          </div>
          <span
            className="display-tight pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full border border-line bg-bg-elev px-2 py-0.5 text-xs font-black text-fg-faint sm:hidden"
            aria-hidden
          >
            VS
          </span>
          <HeroSide
            side={b}
            align="right"
            lead={arena.leader === 'b'}
            winner={arena.winner === 'b'}
          />
        </div>

        {/* lead line */}
        <div className="flex flex-col items-center gap-1 text-center">
          {arena.status === 'scheduled' ? (
            <p className="display text-xl font-bold sm:text-2xl">
              Opens in {fmtCountdown(cd.secs)}
            </p>
          ) : arena.status === 'cancelled' ? (
            <p className="display text-xl font-bold text-fall sm:text-2xl">
              Arena cancelled — everything is withdrawable
            </p>
          ) : arena.status === 'settled' && arena.winner ? (
            <p className="display inline-flex items-center gap-2 text-xl font-bold sm:text-2xl">
              <Trophy size={20} className="text-volt-fg" aria-hidden />
              {arena.winner === 'tie'
                ? 'DRAW — pool rolls over'
                : `${sideOf(arena, arena.winner).asset.symbol} WINS`}
            </p>
          ) : leader ? (
            <p className="display text-xl font-bold sm:text-2xl md:text-3xl">
              <span style={{ color: leader.asset.color }}>{leader.asset.symbol}</span> leads by{' '}
              <span className="tnum">+{arena.leadPct.toFixed(2)}%</span>
            </p>
          ) : (
            <p className="display text-xl font-bold sm:text-2xl">Dead even</p>
          )}
          {!finished && arena.status !== 'scheduled' ? (
            <p className="text-sm text-fg-muted">
              {arena.totalBackingUsd > 0
                ? `${Math.round(a.backingShare * 100)}% of Tribe backing ${a.asset.symbol} · ${fmtUsd(arena.totalBackingUsd)} backing`
                : 'No backing yet — pick a side and be first in.'}
            </p>
          ) : null}
        </div>

        {arena.totalBackingUsd > 0 ? <ConvictionBar a={a} b={b} height="lg" /> : null}

        {/* stats */}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat
            label={cd.label}
            value={
              cd.secs > 0 ? <Countdown arena={arena} now={now} showLabel={false} size="md" /> : '—'
            }
          />
          <Stat
            label="Backing"
            value={arena.totalBackingUsd > 0 ? fmtUsd(arena.totalBackingUsd) : '—'}
          />
          <Stat
            label="Backers"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Users size={16} strokeWidth={1.75} aria-hidden />{' '}
                {arena.participants.toLocaleString('en-US')}
              </span>
            }
          />
          <Stat
            label="Reward pool"
            value={
              arena.rewardPoolUsd > 0 ? (
                <span className="text-gold-fg">{fmtUsd(arena.rewardPoolUsd)}</span>
              ) : (
                'Fees so far'
              )
            }
            hint={
              leader && arena.status === 'live'
                ? `${fmtMultiplier(Math.max(a.multiplier, b.multiplier))} underdog`
                : undefined
            }
          />
        </dl>

        {/* CTAs */}
        {backable ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <button
              type="button"
              className="asset-fill h-12 rounded-[14px] px-4 text-base font-extrabold tracking-wide hover:brightness-95 active:scale-[0.98] sm:h-14 sm:text-lg"
              style={{ ['--asset' as string]: a.asset.color, color: onAsset(a.asset.color) }}
              onClick={() => openBack(arena, 'a')}
              data-testid="hero-back-a"
            >
              BACK {a.asset.symbol}
            </button>
            <button
              type="button"
              className="asset-fill h-12 rounded-[14px] px-4 text-base font-extrabold tracking-wide hover:brightness-95 active:scale-[0.98] sm:h-14 sm:text-lg"
              style={{ ['--asset' as string]: b.asset.color, color: onAsset(b.asset.color) }}
              onClick={() => openBack(arena, 'b')}
              data-testid="hero-back-b"
            >
              BACK {b.asset.symbol}
            </button>
          </div>
        ) : (
          <ClosedNote arena={arena} />
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="display text-base font-bold text-fg-muted sm:text-lg">
            Own what you believe in.
          </p>
          {linkTo ? (
            <Link
              href={`/arena/${arena.slug}`}
              className="text-sm font-semibold text-volt-fg hover:underline"
            >
              Open Arena →
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HeroSide({
  side,
  align,
  lead,
  winner,
}: {
  side: ArenaView['sides'][number];
  align: 'left' | 'right';
  lead: boolean;
  winner: boolean;
}) {
  const right = align === 'right';
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 sm:gap-3 ${right ? 'items-end text-right' : 'items-start text-left'}`}
      style={{ ['--asset' as string]: side.asset.color }}
    >
      <div className={`flex items-center gap-2 sm:gap-3 ${right ? 'flex-row-reverse' : ''}`}>
        <AssetLogo asset={side.asset} size={40} className="sm:!size-14 md:!size-16" />
        <div className={`flex min-w-0 flex-col ${right ? 'items-end' : 'items-start'}`}>
          <span
            className={`display truncate text-xl font-extrabold leading-none sm:text-4xl md:text-5xl ${lead ? 'lead-underline' : ''}`}
          >
            {side.asset.symbol}
          </span>
          <span className="micro mt-1 text-fg-muted">
            {side.asset.classTag}
            {winner ? <span className="ml-2 text-volt-fg">WINNER</span> : null}
          </span>
        </div>
      </div>
      <PerfValue pct={side.perfPct} size="hero" caption="since Arena start" />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-[color-mix(in_oklab,var(--bg)_55%,transparent)] px-3 py-2.5">
      <dt className="micro text-fg-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-semibold">{value}</dd>
      {hint ? <dd className="micro mt-0.5 whitespace-nowrap text-gold-fg">{hint}</dd> : null}
    </div>
  );
}

function ClosedNote({ arena }: { arena: ArenaView }) {
  const text: Record<ArenaView['status'], string> = {
    live: '',
    backing_closed:
      'Backing is closed for this Arena. Positions are locked in until the end; you can still exit.',
    scheduled: 'Backing opens when the Arena starts and the start prices are verified on Pyth.',
    settling: 'Arena ended. Settlement is pending Pyth end prices; claims open right after.',
    settled: 'Arena settled. Winners can claim Arena Rewards; everyone can withdraw their asset.',
    cancelled:
      'This Arena was cancelled. No Arena Rewards; every position can be withdrawn in full.',
  };
  return (
    <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-center text-sm text-fg-muted">
      {text[arena.status]}
    </p>
  );
}

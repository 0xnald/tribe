'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { useLiveArena } from '@/hooks/useLiveArenas';
import { useNow } from '@/hooks/useNow';
import { sideOf, type ArenaView } from '@/lib/arena/model';
import { explorerAddressUrl } from '@/lib/config/network';
import { fmtTime, shortAddress } from '@/lib/format';

import { ArenaHero } from './ArenaHero';
import { ArenaActivity, MarketPanel, RewardSummary } from './ArenaPanels';
import { RelativePerformanceChart } from './RelativePerformanceChart';
import { ShareArena } from './ShareArena';

export function ArenaDetail({ initial, serverNow }: { initial: ArenaView; serverNow: number }) {
  const live = useLiveArena(initial.slug, initial, serverNow);
  const now = useNow(serverNow);
  const arena = live.data;
  const [a, b] = arena.sides;

  return (
    <main className="container-x flex flex-col gap-6 py-4 md:gap-8 md:py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-fg">
          Explore
        </Link>
        <span className="mx-2 text-fg-faint">/</span>
        <span className="text-fg">
          {a.asset.symbol} vs {b.asset.symbol}
        </span>
        {live.stale ? <span className="ml-3 text-ember">· live refresh paused</span> : null}
      </nav>

      <ArenaHero arena={arena} now={now} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <section
            className="flex flex-col gap-4 rounded-[20px] border border-line bg-bg-elev p-5"
            aria-labelledby="perf-heading"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="perf-heading" className="display text-xl font-bold">
                Who is winning?
              </h2>
              <span className="text-xs text-fg-muted">
                {arena.provenance === 'demo'
                  ? 'Simulated Arena prices · '
                  : arena.provenance === 'devnet'
                    ? 'Devnet Pyth feeds · '
                    : ''}
                normalised from {fmtTime(arena.startTs)}
              </span>
            </div>
            <RelativePerformanceChart arena={arena} history={arena.history} />
            <p className="text-sm text-fg-muted">
              Both sides start at 0.00%. The Arena is decided by the difference at the end, not by
              the direction of the market:{' '}
              {arena.leader === 'tie'
                ? 'right now it is a dead heat.'
                : `right now ${sideOf(arena, arena.leader).asset.symbol} is ahead by ${arena.leadPct.toFixed(2)} points.`}
            </p>
          </section>

          <MarketPanel arena={arena} />
          <ArenaActivity arena={arena} items={arena.activity} now={now} />
        </div>

        <aside className="flex flex-col gap-6">
          <RewardSummary arena={arena} now={now} />

          <section
            className="flex flex-col gap-3 rounded-[20px] border border-line bg-bg-elev p-5 text-sm"
            aria-labelledby="details-heading"
          >
            <h2 id="details-heading" className="display text-xl font-bold">
              Arena details
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-fg-muted">Creator</dt>
              <dd className="text-right">
                {arena.creator.label}
                {arena.creator.firstParty ? (
                  <span className="micro ml-2 rounded-full bg-[color-mix(in_oklab,var(--volt)_18%,transparent)] px-1.5 py-0.5 text-volt">
                    Tribe
                  </span>
                ) : null}
              </dd>
              <dt className="text-fg-muted">Starts</dt>
              <dd className="tnum text-right">{fmtTime(arena.startTs)}</dd>
              <dt className="text-fg-muted">Backing closes</dt>
              <dd className="tnum text-right">{fmtTime(arena.backingCloseTs)}</dd>
              <dt className="text-fg-muted">Ends</dt>
              <dd className="tnum text-right">{fmtTime(arena.endTs)}</dd>
              <dt className="text-fg-muted">Tribe fee</dt>
              <dd className="tnum text-right">{(arena.feeBps / 100).toFixed(2)}% of backing</dd>
              <dt className="text-fg-muted">Settlement</dt>
              <dd className="text-right">Pyth end prices, permissionless</dd>
              {arena.onchain ? (
                <>
                  <dt className="text-fg-muted">On-chain</dt>
                  <dd className="text-right">
                    <a
                      href={explorerAddressUrl(arena.onchain.arena)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[#9db3ff] hover:underline"
                    >
                      {shortAddress(arena.onchain.arena)} <ExternalLink size={12} aria-hidden />
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
              <span className="text-fg-muted">Share this Arena</span>
              <ShareArena arena={arena} />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

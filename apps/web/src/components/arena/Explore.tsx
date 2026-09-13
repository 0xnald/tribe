'use client';

import { Flame, Sparkles, Timer, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useLiveArenas } from '@/hooks/useLiveArenas';
import { useNow } from '@/hooks/useNow';
import type { ArenaView } from '@/lib/arena/model';

import { ArenaCard } from './ArenaCard';
import { ArenaHero } from './ArenaHero';

type Filter =
  | 'live'
  | 'trending'
  | 'ending'
  | 'meme-vs-stock'
  | 'crypto-vs-stock'
  | 'stock-vs-stock'
  | 'crypto-vs-crypto'
  | 'devnet';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'trending', label: 'Trending' },
  { id: 'ending', label: 'Ending soon' },
  { id: 'meme-vs-stock', label: 'Meme vs Stock' },
  { id: 'crypto-vs-stock', label: 'Crypto vs Stock' },
  { id: 'stock-vs-stock', label: 'Stock vs Stock' },
  { id: 'crypto-vs-crypto', label: 'Crypto vs Crypto' },
  { id: 'devnet', label: 'Devnet protocol' },
];

export function applyFilter(arenas: ArenaView[], f: Filter, now: number): ArenaView[] {
  switch (f) {
    case 'live':
      return arenas.filter((a) => a.status === 'live' || a.status === 'backing_closed');
    case 'trending':
      return arenas.filter((a) => a.trending);
    case 'ending':
      return arenas
        .filter(
          (a) =>
            (a.status === 'live' || a.status === 'backing_closed') && a.endTs - now < 12 * 3600,
        )
        .sort((x, y) => x.endTs - y.endTs);
    case 'devnet':
      return arenas.filter((a) => a.provenance === 'devnet');
    default:
      return arenas.filter((a) => a.category === f);
  }
}

const NARRATIVES = [
  { title: 'Memes vs Wall Street', icon: Flame, blurb: 'Internet money against the S&P.' },
  { title: 'Crypto vs Tech', icon: Sparkles, blurb: 'Layer 1s against the Nasdaq.' },
  { title: 'Community Favorites', icon: Trophy, blurb: 'Where the Tribe is loudest.' },
  { title: 'Biggest Upsets', icon: Timer, blurb: 'Underdogs paying 2× conviction.' },
];

export function Explore({ initial, serverNow }: { initial: ArenaView[]; serverNow: number }) {
  const live = useLiveArenas(initial, serverNow);
  const now = useNow(serverNow);
  const arenas = live.data;
  const [filter, setFilter] = useState<Filter>('live');
  const [narrative, setNarrative] = useState<string | null>(null);

  const featured = useMemo(
    () =>
      arenas.find((a) => a.featured && a.status === 'live') ??
      arenas.find((a) => a.status === 'live') ??
      arenas[0],
    [arenas],
  );
  const feed = useMemo(() => {
    // the hero already shows the featured Arena; don't repeat it directly underneath
    let list = applyFilter(arenas, filter, now).filter((a) => a.id !== featured?.id);
    if (narrative) list = list.filter((a) => a.narrative === narrative);
    return list;
  }, [arenas, filter, narrative, now, featured]);
  const hasDevnet = arenas.some((a) => a.provenance === 'devnet');

  return (
    <main className="container-x flex flex-col gap-10 py-4 md:gap-14 md:py-8">
      {/* hero */}
      {featured ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h1 className="display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Featured Arena
            </h1>
            <p className="hidden text-sm text-fg-muted sm:block">
              Don&apos;t bet on what you believe in. Own it.
            </p>
          </div>
          <ArenaHero arena={featured} now={now} linkTo />
        </div>
      ) : null}

      {/* filters + feed */}
      <section className="flex flex-col gap-4" aria-labelledby="arenas-heading">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2
              id="arenas-heading"
              className="display text-2xl font-extrabold tracking-tight sm:text-3xl"
            >
              Arenas
            </h2>
            <p className="text-sm text-fg-muted">
              Pick a side. Own the asset. Hold your conviction.
              {live.stale ? (
                <span className="ml-2 text-ember-fg">
                  · refresh paused ({live.error ?? 'offline'})
                </span>
              ) : null}
            </p>
          </div>
          <div
            className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
            role="tablist"
            aria-label="Arena filters"
          >
            {FILTERS.filter((f) => f.id !== 'devnet' || hasDevnet).map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                  filter === f.id
                    ? 'border-volt bg-volt text-[#0e0f12]'
                    : 'border-line text-fg-muted hover:border-line-strong hover:text-fg'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {narrative ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Narrative:</span>
            <span className="font-semibold">{narrative}</span>
            <button
              type="button"
              className="text-volt-fg hover:underline"
              onClick={() => setNarrative(null)}
            >
              clear
            </button>
          </div>
        ) : null}

        {feed.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-line-strong p-10 text-center">
            <p className="display text-xl font-bold">No Arenas here right now.</p>
            <p className="mt-1 text-sm text-fg-muted">
              Try another filter — new Arenas open every day.
            </p>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            data-testid="arena-feed"
          >
            {feed.map((a, i) => (
              <ArenaCard
                key={a.id}
                arena={a}
                now={now}
                variant={i === 0 && a.trending && filter !== 'devnet' ? 'featured' : 'default'}
              />
            ))}
          </div>
        )}
      </section>

      {/* narratives */}
      <section className="flex flex-col gap-4" aria-labelledby="narratives-heading">
        <h2
          id="narratives-heading"
          className="display text-xl font-extrabold tracking-tight sm:text-2xl"
        >
          Trending narratives
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {NARRATIVES.map(({ title, icon: Icon, blurb }) => {
            const count = arenas.filter(
              (a) => a.narrative === title && a.status !== 'cancelled',
            ).length;
            return (
              <button
                key={title}
                type="button"
                onClick={() => {
                  setNarrative(title);
                  setFilter('live');
                  document
                    .getElementById('arenas-heading')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex flex-col items-start gap-2 rounded-[16px] border border-line bg-bg-elev p-4 text-left transition-colors hover:border-line-strong"
              >
                <Icon size={20} className="text-volt-fg" strokeWidth={1.75} aria-hidden />
                <span className="display text-base font-bold leading-tight">{title}</span>
                <span className="text-xs text-fg-muted">{blurb}</span>
                <span className="micro mt-auto text-fg-faint">
                  {count} arena{count === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* how it works */}
      <section
        className="flex flex-col gap-5 rounded-[24px] border border-line bg-bg-elev p-5 md:p-8"
        aria-labelledby="how-heading"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="how-heading"
            className="display text-2xl font-extrabold tracking-tight sm:text-3xl"
          >
            How Tribe works
          </h2>
          <p className="max-w-2xl text-sm text-fg-muted">
            Two real assets compete on relative performance for a fixed window. You don&apos;t bet
            on the winner — you own the asset you believe in.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            [
              'Pick a side.',
              'BONK or TSLAx. SOL or SPYx. Every Arena is two real assets, one question: who performs better from now until the bell?',
            ],
            [
              'Own the asset.',
              'Backing buys the real token into your own Arena Position Vault. Your principal never leaves your side, whoever wins.',
            ],
            [
              'Hold your conviction.',
              'Arena Rewards — fees and sponsor pools — go to the winning side, weighted by how much you held and for how long. Underdogs earn up to 2× weight.',
            ],
          ].map(([h, p], i) => (
            <li key={h} className="flex flex-col gap-2 rounded-[16px] border border-line p-4">
              <span className="display inline-flex size-8 items-center justify-center rounded-full bg-volt text-sm font-black text-[#0e0f12]">
                {i + 1}
              </span>
              <span className="display text-lg font-bold">{h}</span>
              <span className="text-sm text-fg-muted">{p}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-fg-faint">
          Losing side keeps its asset — the Arena only decides who shares the reward pool. Tribe fee
          0.50% of backing, split 40% reward pool / 40% protocol / 20% Arena Creator.
        </p>
      </section>
    </main>
  );
}

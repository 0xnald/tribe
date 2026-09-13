import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/Button';
import { SEED_PAIRS, findAsset } from '@tribe/core';

export const metadata: Metadata = { title: 'Create Arena' };

/** Placeholder: permissionless creation ships after the core loop (STOCKLANA_PLAN §1). */
export default function CreatePage() {
  return (
    <main className="container-x flex flex-col gap-8 py-8 md:py-12">
      <div className="flex flex-col gap-2">
        <p className="micro text-fg-muted">Arena Creator</p>
        <h1 className="display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Create an Arena
        </h1>
        <p className="max-w-xl text-sm text-fg-muted">
          Pick two assets from the Tribe registry, a window, and an optional sponsor pool. Creators
          earn 20% of every Tribe fee in their Arena. Permissionless creation opens in the next
          release — the program already supports it.
        </p>
      </div>
      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Supported matchups"
      >
        {SEED_PAIRS.map(([a, b]) => {
          const A = findAsset(a);
          const B = findAsset(b);
          if (!A || !B) return null;
          return (
            <div
              key={`${a}-${b}`}
              className="flex items-center justify-between rounded-[16px] border border-line bg-bg-elev p-4"
            >
              <span className="display text-lg font-bold" style={{ color: A.visual.color }}>
                {A.displaySymbol}
              </span>
              <span className="display-tight text-fg-faint">VS</span>
              <span className="display text-lg font-bold" style={{ color: B.visual.color }}>
                {B.displaySymbol}
              </span>
            </div>
          );
        })}
      </section>
      <div className="flex items-center gap-3">
        <ButtonLink href="/" variant="primary">
          Explore live Arenas
        </ButtonLink>
        <span className="text-xs text-fg-faint">Creation form: coming next.</span>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ArenaDetail } from '@/components/arena/ArenaDetail';
import { sideOf } from '@/lib/arena/model';
import { getArena } from '@/lib/arena/repo';
import { nowSecs } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps<'/arena/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const arena = await getArena(slug);
  if (!arena) return { title: 'Arena not found' };
  const [a, b] = arena.sides;
  const lead =
    arena.leader === 'tie'
      ? 'Dead even'
      : `${sideOf(arena, arena.leader).asset.symbol} leads +${arena.leadPct.toFixed(2)}%`;
  const title = `${a.asset.symbol} vs ${b.asset.symbol}`;
  const description = `${lead} · ${Math.round(a.backingShare * 100)}% of Tribe backing ${a.asset.symbol}. Own what you believe in.`;
  return {
    title,
    description,
    openGraph: { title: `${title} · Tribe Arena`, description, url: `/arena/${slug}` },
    twitter: { card: 'summary_large_image', title: `${title} · Tribe Arena`, description },
  };
}

export default async function ArenaPage({ params }: PageProps<'/arena/[slug]'>) {
  const { slug } = await params;
  const now = nowSecs();
  const arena = await getArena(slug, now);
  if (!arena) notFound();
  return <ArenaDetail initial={arena} serverNow={now} />;
}

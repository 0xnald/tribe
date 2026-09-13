'use client';

import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

import { sideOf, type ArenaView } from '@/lib/arena/model';
import { getNetworkConfig } from '@/lib/config/network';

import { Button } from '../ui/Button';

/** Share text mirrors the OG card: matchup, lead, backing, time left, tagline. */
export function shareText(arena: ArenaView): string {
  const [a, b] = arena.sides;
  const lead =
    arena.leader === 'tie'
      ? 'Dead even'
      : `${sideOf(arena, arena.leader).asset.symbol} leads +${arena.leadPct.toFixed(2)}%`;
  const pct = Math.round(a.backingShare * 100);
  return `${a.asset.symbol} vs ${b.asset.symbol} — ${lead}. ${pct}% of Tribe backing ${a.asset.symbol}. Own what you believe in.`;
}

export function arenaUrl(arena: ArenaView): string {
  return `${getNetworkConfig().appUrl}/arena/${arena.slug}`;
}

export function ShareArena({ arena, compact = false }: { arena: ArenaView; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = arenaUrl(arena);
  const text = shareText(arena);

  const onShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Tribe Arena', text, url });
        return;
      } catch {
        /* user cancelled → fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        '_blank',
        'noopener',
      );
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void onShare()}
      aria-label="Share this Arena"
      className={compact ? 'px-2.5' : ''}
    >
      {copied ? (
        <Check size={16} aria-hidden />
      ) : (
        <Share2 size={16} strokeWidth={1.75} aria-hidden />
      )}
      {compact ? null : copied ? 'Copied' : 'Share'}
    </Button>
  );
}

import { ImageResponse } from 'next/og';

import { sideOf } from '@/lib/arena/model';
import { getArena } from '@/lib/arena/repo';
import { fmtCountdown, fmtPct } from '@/lib/format';

export const alt = 'Tribe Arena';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Share card (DESIGN_SYSTEM §6.10): two tinted halves, names, performance, lead, backing, time left. */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const now = Math.floor(Date.now() / 1000);
  const arena = await getArena(slug, now);
  if (!arena) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0e0f12',
          color: '#f4f1ea',
          fontSize: 64,
          fontWeight: 800,
        }}
      >
        Tribe
      </div>,
      size,
    );
  }
  const [a, b] = arena.sides;
  const lead =
    arena.leader === 'tie'
      ? 'DEAD EVEN'
      : `${sideOf(arena, arena.leader).asset.symbol} LEADS +${arena.leadPct.toFixed(2)}%`;
  const left = arena.endTs - now;
  const pct = Math.round(a.backingShare * 100);
  const tone = (v: number) => (v > 0 ? '#19c37d' : v < 0 ? '#f03e5a' : '#9a9faa');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0e0f12',
        color: '#f4f1ea',
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 600,
          height: 630,
          background: `linear-gradient(135deg, ${a.asset.color}55, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 600,
          height: 630,
          background: `linear-gradient(225deg, ${b.asset.color}55, transparent 70%)`,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '40px 56px 0',
          fontSize: 22,
          letterSpacing: 2,
          color: '#9a9faa',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 12, background: '#d9ff3d' }} />
          {arena.status === 'live' || arena.status === 'backing_closed'
            ? 'LIVE ARENA'
            : arena.status.toUpperCase()}{' '}
          · {arena.provenance.toUpperCase()}
        </span>
        <span>{left > 0 ? `${fmtCountdown(left)} LEFT` : ''}</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '30px 56px 0',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 460 }}>
          <span style={{ fontSize: 88, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>
            {a.asset.symbol}
          </span>
          <span style={{ fontSize: 64, fontWeight: 800, color: tone(a.perfPct), marginTop: 12 }}>
            {fmtPct(a.perfPct)}
          </span>
        </div>
        <span style={{ fontSize: 72, fontWeight: 900, color: '#5c616b' }}>VS</span>
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: 460 }}
        >
          <span style={{ fontSize: 88, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>
            {b.asset.symbol}
          </span>
          <span style={{ fontSize: 64, fontWeight: 800, color: tone(b.perfPct), marginTop: 12 }}>
            {fmtPct(b.perfPct)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '36px 56px 0', gap: 10 }}>
        <span style={{ fontSize: 44, fontWeight: 900, color: '#d9ff3d' }}>{lead}</span>
        <span style={{ fontSize: 26, color: '#c9c3b6' }}>
          {pct}% OF TRIBE BACKING {a.asset.symbol}
        </span>
        <div
          style={{
            display: 'flex',
            width: 1088,
            height: 16,
            borderRadius: 16,
            overflow: 'hidden',
            background: '#0a0b0d',
            marginTop: 8,
          }}
        >
          <div style={{ width: `${pct}%`, background: a.asset.color }} />
          <div style={{ flex: 1, background: b.asset.color }} />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 56px',
          marginTop: 'auto',
          marginBottom: 40,
        }}
      >
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 30, fontWeight: 900 }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#d9ff3d',
              color: '#0e0f12',
              fontSize: 24,
            }}
          >
            T
          </span>
          Tribe
        </span>
        <span style={{ fontSize: 30, fontWeight: 800, color: '#f4f1ea' }}>
          OWN WHAT YOU BELIEVE IN.
        </span>
      </div>
    </div>,
    size,
  );
}

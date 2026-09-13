'use client';

import { useId, useMemo, useRef, useState } from 'react';

import type { ArenaView, PerfPoint } from '@/lib/arena/model';
import { fmtPct, fmtTime } from '@/lib/format';

/**
 * Normalised Arena performance from 0 % for both sides (DESIGN_SYSTEM §1.3
 * "who is winning?"). Hand-rolled SVG — no chart library, no candles.
 * Hover / touch reveals both values at a point in time; keyboard users can
 * arrow through the same points.
 */
const W = 720;
const H = 260;
const PAD = { l: 44, r: 12, t: 12, b: 24 };

export function RelativePerformanceChart({
  arena,
  history,
  className = '',
}: {
  arena: ArenaView;
  history: PerfPoint[];
  className?: string;
}) {
  const [a, b] = arena.sides;
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [idx, setIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    if (history.length < 2) return null;
    const t0 = history[0]?.t ?? 0;
    const t1 = history[history.length - 1]?.t ?? 1;
    let min = 0;
    let max = 0;
    for (const p of history) {
      min = Math.min(min, p.a, p.b);
      max = Math.max(max, p.a, p.b);
    }
    const span = Math.max(1, max - min);
    min -= span * 0.1;
    max += span * 0.1;
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    const path = (k: 'a' | 'b') =>
      history
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`)
        .join(' ');
    // gridlines: 0 and two more
    const ticks = [min + (max - min) * 0.25, 0, min + (max - min) * 0.75].filter(
      (v) => v > min && v < max,
    );
    return { x, y, pathA: path('a'), pathB: path('b'), zeroY: y(0), ticks, t0, t1 };
  }, [history]);

  if (!model) {
    return (
      <div
        className={`flex h-[220px] items-center justify-center rounded-[16px] border border-dashed border-line-strong text-sm text-fg-muted ${className}`}
      >
        {arena.status === 'scheduled'
          ? 'Performance starts at 0.00 % when the Arena opens.'
          : 'Not enough data yet.'}
      </div>
    );
  }

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    history.forEach((p, i) => {
      const d = Math.abs(model.x(p.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setIdx(best);
  };

  const cur = idx === null ? history[history.length - 1] : history[idx];
  const leaderNow = cur ? (cur.a > cur.b ? a : cur.b > cur.a ? b : null) : null;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Legend color={a.asset.color} label={a.asset.symbol} value={cur?.a ?? 0} />
        <Legend color={b.asset.color} label={b.asset.symbol} value={cur?.b ?? 0} />
        <span className="ml-auto text-xs text-fg-muted">
          {cur ? fmtTime(cur.t) : ''}
          {leaderNow ? ` · ${leaderNow.asset.symbol} ahead` : ''}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Relative performance since Arena start. ${a.asset.symbol} ${fmtPct(a.perfPct)}, ${b.asset.symbol} ${fmtPct(b.perfPct)}.`}
        tabIndex={0}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setIdx(null)}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) onMove(t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) onMove(t.clientX);
        }}
        onTouchEnd={() => setIdx(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? history.length - 1) - 1));
          if (e.key === 'ArrowRight')
            setIdx((i) => Math.min(history.length - 1, (i ?? history.length - 1) + 1));
          if (e.key === 'Escape') setIdx(null);
        }}
      >
        <defs>
          <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={a.asset.color} stopOpacity="0.28" />
            <stop offset="1" stopColor={a.asset.color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-b`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={b.asset.color} stopOpacity="0.28" />
            <stop offset="1" stopColor={b.asset.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {model.ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={model.y(v)}
              y2={model.y(v)}
              stroke="var(--line)"
              strokeDasharray="3 4"
            />
            <text
              x={PAD.l - 6}
              y={model.y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--fg-faint)"
              className="tnum"
            >
              {fmtPct(v, 1)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={model.zeroY}
          y2={model.zeroY}
          stroke="var(--line-strong)"
        />
        <text
          x={PAD.l - 6}
          y={model.zeroY + 4}
          textAnchor="end"
          fontSize="11"
          fill="var(--fg-muted)"
        >
          0%
        </text>
        <path
          d={`${model.pathA} L${model.x(model.t1)},${model.zeroY} L${model.x(model.t0)},${model.zeroY} Z`}
          fill={`url(#${id}-a)`}
        />
        <path
          d={`${model.pathB} L${model.x(model.t1)},${model.zeroY} L${model.x(model.t0)},${model.zeroY} Z`}
          fill={`url(#${id}-b)`}
        />
        <path
          d={model.pathA}
          fill="none"
          stroke={a.asset.color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={model.pathB}
          fill="none"
          stroke={b.asset.color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {cur ? (
          <g>
            <line
              x1={model.x(cur.t)}
              x2={model.x(cur.t)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--fg-faint)"
              strokeDasharray="2 3"
            />
            <circle
              cx={model.x(cur.t)}
              cy={model.y(cur.a)}
              r="5"
              fill={a.asset.color}
              stroke="var(--bg-elev)"
              strokeWidth="2"
            />
            <circle
              cx={model.x(cur.t)}
              cy={model.y(cur.b)}
              r="5"
              fill={b.asset.color}
              stroke="var(--bg-elev)"
              strokeWidth="2"
            />
          </g>
        ) : null}
        <text x={PAD.l} y={H - 6} fontSize="11" fill="var(--fg-faint)">
          start
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize="11" fill="var(--fg-faint)" textAnchor="end">
          now
        </text>
      </svg>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  const tone = value > 0 ? 'text-rise' : value < 0 ? 'text-fall' : 'text-fg-muted';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block size-2.5 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="font-semibold">{label}</span>
      <span className={`tnum font-mono ${tone}`}>{fmtPct(value)}</span>
    </span>
  );
}

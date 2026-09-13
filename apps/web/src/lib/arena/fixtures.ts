/**
 * Arena fixture engine — deterministic demo Arenas for presentation.
 *
 * Every number is a pure function of (definition, now). The same `now`
 * always renders the same Arena, so screenshots and tests are stable, while
 * a running clock makes the Arenas evolve like live events: performance
 * paths, backing, participants and activity all move forward in time.
 *
 * Provenance is always `demo`. Fixture prices are simulated Arena prices;
 * they are never presented as market prices (the market layer is separate).
 */
import {
  DEFAULT_ARENA_PARAMS,
  ONE_Q4,
  findAsset,
  rampMultiplierQ4,
  rawMultiplierQ4,
  warmupSecs,
  type RegistryAsset,
} from '@tribe/core';

import type {
  ActivityItem,
  ArenaCategory,
  ArenaSideView,
  ArenaStatus,
  ArenaView,
  AssetIdentity,
  PerfPoint,
  SideKey,
} from './model';

const H = 3600;
const D = 24 * H;

/** Reference Arena start prices (USD, rounded from Jupiter Price v3 on 2026-09-13). Demo only. */
const REF_PRICE: Record<string, number> = {
  BONK: 0.0000276,
  TSLAx: 365.25,
  SOL: 214.6,
  SPYx: 662.1,
  WBTC: 116_420,
  MSTRx: 338.9,
  PENGU: 0.0342,
  DISx: 118.4,
  NVDAx: 177.8,
  AAPLx: 233.6,
  WIF: 0.842,
  GMEx: 24.9,
};

export interface FixtureDef {
  slug: string;
  a: string;
  b: string;
  category: ArenaCategory;
  narrative: string;
  /** Target performance (percent) of each side at Arena end. */
  targetA: number;
  targetB: number;
  volA: number;
  volB: number;
  durationSecs: number;
  /**
   * Where in its cycle the Arena sits when the clock reads `anchor`:
   * elapsed seconds since start at that moment. Rolls forward with a gap.
   */
  elapsedAtAnchor: number;
  /** Fixed status override for state demos. */
  kind: 'rolling' | 'scheduled' | 'settled' | 'cancelled' | 'backing_closed';
  backingUsd: number;
  splitA: number; // 0..1 share of backing on side A at anchor
  participants: number;
  sponsorUsd: number;
  featured?: boolean;
  trending?: boolean;
  creator: { label: string; address: string | null; firstParty: boolean };
}

/** Anchor clock for the rolling schedule (an arbitrary instant; keeps cycles aligned). */
const ANCHOR = 1_789_300_000; // 2026-09-13 ~09:00 UTC
const GAP = 45 * 60;

const ADDR = {
  tribe: 'TRiBEw9xg1w9m7xGqqVwK2m5b3dQ6JXwXh9XJm3Zt1e',
  nald: 'GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf',
  memelord: '7f3kQwE2pHhN6gJtR9yUvBcXaLmZs4dPq8W1KnT5A9Aa',
  quant: '3pQz8vLmNcRt6yUeXwBk2sHfG9dJaMn4TiVoE7CyKq2B',
};

export const FIXTURE_DEFS: readonly FixtureDef[] = [
  {
    slug: 'bonk-vs-tslax',
    a: 'BONK',
    b: 'TSLAx',
    category: 'meme-vs-stock',
    narrative: 'Memes vs Wall Street',
    targetA: 8.4,
    targetB: 2.2,
    volA: 1.7,
    volB: 0.6,
    durationSecs: D,
    elapsedAtAnchor: D - (1 * H + 42 * 60 + 18),
    kind: 'rolling',
    backingUsd: 184_291,
    splitA: 0.73,
    participants: 4_821,
    sponsorUsd: 5_000,
    featured: true,
    trending: true,
    creator: { label: 'Tribe', address: ADDR.tribe, firstParty: true },
  },
  {
    slug: 'sol-vs-spyx',
    a: 'SOL',
    b: 'SPYx',
    category: 'crypto-vs-stock',
    narrative: 'Crypto vs Tech',
    targetA: 3.1,
    targetB: 0.9,
    volA: 1.6,
    volB: 0.35,
    durationSecs: 3 * D,
    elapsedAtAnchor: 1.2 * D,
    kind: 'rolling',
    backingUsd: 412_880,
    splitA: 0.58,
    participants: 9_310,
    sponsorUsd: 25_000,
    trending: true,
    creator: { label: 'Tribe', address: ADDR.tribe, firstParty: true },
  },
  {
    slug: 'wbtc-vs-mstrx',
    a: 'WBTC',
    b: 'MSTRx',
    category: 'crypto-vs-stock',
    narrative: 'Biggest Upsets',
    targetA: 1.4,
    targetB: 4.9,
    volA: 0.9,
    volB: 2.1,
    durationSecs: 7 * D,
    elapsedAtAnchor: 5.4 * D,
    kind: 'rolling',
    backingUsd: 96_400,
    splitA: 0.81,
    participants: 1_204,
    sponsorUsd: 0,
    creator: { label: '0xNald', address: ADDR.nald, firstParty: false },
  },
  {
    slug: 'pengu-vs-disx',
    a: 'PENGU',
    b: 'DISx',
    category: 'meme-vs-stock',
    narrative: 'Community Favorites',
    targetA: -2.6,
    targetB: 1.1,
    volA: 2.8,
    volB: 0.5,
    durationSecs: 2 * D,
    elapsedAtAnchor: 0.35 * D,
    kind: 'rolling',
    backingUsd: 57_120,
    splitA: 0.66,
    participants: 2_044,
    sponsorUsd: 2_500,
    trending: true,
    creator: { label: 'memelord.sol', address: ADDR.memelord, firstParty: false },
  },
  {
    slug: 'nvdax-vs-aaplx',
    a: 'NVDAx',
    b: 'AAPLx',
    category: 'stock-vs-stock',
    narrative: 'Crypto vs Tech',
    targetA: 2.7,
    targetB: 1.8,
    volA: 0.8,
    volB: 0.5,
    durationSecs: 5 * D,
    elapsedAtAnchor: 2.1 * D,
    kind: 'rolling',
    backingUsd: 231_500,
    splitA: 0.52,
    participants: 3_388,
    sponsorUsd: 10_000,
    creator: { label: 'quant.sol', address: ADDR.quant, firstParty: false },
  },
  {
    slug: 'wif-vs-gmex',
    a: 'WIF',
    b: 'GMEx',
    category: 'meme-vs-stock',
    narrative: 'Memes vs Wall Street',
    targetA: 6.2,
    targetB: 7.9,
    volA: 3.2,
    volB: 2.6,
    durationSecs: D,
    elapsedAtAnchor: D - 6 * H,
    kind: 'rolling',
    backingUsd: 42_910,
    splitA: 0.44,
    participants: 1_566,
    sponsorUsd: 0,
    creator: { label: 'memelord.sol', address: ADDR.memelord, firstParty: false },
  },
  // ── state demos (not rolling)
  {
    slug: 'sol-vs-nvdax-next',
    a: 'SOL',
    b: 'NVDAx',
    category: 'crypto-vs-stock',
    narrative: 'Crypto vs Tech',
    targetA: 0,
    targetB: 0,
    volA: 0,
    volB: 0,
    durationSecs: 3 * D,
    elapsedAtAnchor: -5 * H,
    kind: 'scheduled',
    backingUsd: 0,
    splitA: 0.5,
    participants: 0,
    sponsorUsd: 15_000,
    creator: { label: 'Tribe', address: ADDR.tribe, firstParty: true },
  },
  {
    slug: 'bonk-vs-tslax-round-1',
    a: 'BONK',
    b: 'TSLAx',
    category: 'meme-vs-stock',
    narrative: 'Memes vs Wall Street',
    targetA: 5.9,
    targetB: 7.7,
    volA: 2.0,
    volB: 0.9,
    durationSecs: D,
    elapsedAtAnchor: D + 9 * H,
    kind: 'settled',
    backingUsd: 141_020,
    splitA: 0.69,
    participants: 3_902,
    sponsorUsd: 5_000,
    creator: { label: 'Tribe', address: ADDR.tribe, firstParty: true },
  },
  {
    slug: 'pengu-vs-gmex-cancelled',
    a: 'PENGU',
    b: 'GMEx',
    category: 'meme-vs-stock',
    narrative: 'Community Favorites',
    targetA: 0,
    targetB: 0,
    volA: 0,
    volB: 0,
    durationSecs: D,
    elapsedAtAnchor: 2 * D,
    kind: 'cancelled',
    backingUsd: 8_400,
    splitA: 0.5,
    participants: 61,
    sponsorUsd: 0,
    creator: { label: 'quant.sol', address: ADDR.quant, firstParty: false },
  },
];

// ─── deterministic helpers

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Path {
  /** Performance in percent at `elapsed` seconds into the Arena. */
  at(elapsed: number): number;
}

/** Smooth seeded path: eases toward `target` with layered sines for texture. */
function makePath(seed: number, target: number, vol: number, duration: number): Path {
  const rnd = mulberry32(seed);
  const comps = Array.from({ length: 5 }, (_, i) => ({
    amp: vol * (0.55 / (i + 1)) * (0.6 + rnd() * 0.8),
    freq: (1.5 + i * 2.3 + rnd() * 1.7) * (2 * Math.PI),
    phase: rnd() * 2 * Math.PI,
  }));
  return {
    at(elapsed) {
      const x = Math.max(0, Math.min(1, elapsed / duration));
      // ease-out drift so most of the move happens early, like a real session
      const drift = target * (1 - Math.pow(1 - x, 3));
      let noise = 0;
      for (const c of comps) noise += c.amp * Math.sin(c.freq * x + c.phase);
      // noise fades in from zero at start (everything starts at 0.00 %)
      return drift + noise * Math.min(1, x * 6);
    },
  };
}

function identity(a: RegistryAsset): AssetIdentity {
  return {
    symbol: a.displaySymbol,
    name: a.name,
    mint: a.mint,
    decimals: a.decimals,
    color: a.visual.color,
    logoUrl: a.visual.logoUrl,
    classTag: a.visual.classTag,
    category: a.category,
    isXStock: a.isXStock,
    marketHours: a.marketHours,
  };
}

function schedule(def: FixtureDef, now: number): { startTs: number; endTs: number; cycle: number } {
  if (def.kind === 'scheduled') {
    // always in the future: opens a few hours after the current hour boundary
    const startTs = Math.ceil(now / H) * H - def.elapsedAtAnchor;
    return { startTs, endTs: startTs + def.durationSecs, cycle: 0 };
  }
  if (def.kind !== 'rolling') {
    const startTs = ANCHOR - def.elapsedAtAnchor;
    return { startTs, endTs: startTs + def.durationSecs, cycle: 0 };
  }
  const period = def.durationSecs + GAP;
  const firstStart = ANCHOR - def.elapsedAtAnchor;
  const cycle = Math.floor((now - firstStart) / period);
  const startTs = firstStart + cycle * period;
  return { startTs, endTs: startTs + def.durationSecs, cycle };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const NAMES = [
  '7f3…9Aa',
  'memelord.sol',
  'quant.sol',
  'DzK…4pQ',
  'anna.sol',
  '9xR…Lm2',
  'chad.sol',
  'Hq2…8vT',
  'pengu.maxi',
  'Bk7…zzE',
];

function buildActivity(
  def: FixtureDef,
  seed: number,
  startTs: number,
  endTs: number,
  backingCloseTs: number,
  now: number,
  symbols: [string, string],
  pathA: Path,
  pathB: Path,
  duration: number,
): ActivityItem[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const items: ActivityItem[] = [];
  items.push({
    id: 'start',
    ts: startTs,
    kind: 'start',
    text: `Arena is live. ${symbols[0]} vs ${symbols[1]}.`,
  });
  if (def.sponsorUsd > 0) {
    items.push({
      id: 'sponsor',
      ts: startTs + 90,
      kind: 'sponsor',
      text: `$${def.sponsorUsd.toLocaleString('en-US')} sponsor reward added`,
      amountUsd: def.sponsorUsd,
    });
  }
  // backs: ~40 over the Arena, weighted to side A by split
  const n = 40;
  for (let i = 0; i < n; i++) {
    const ts = startTs + Math.floor(rnd() * duration);
    const side: SideKey = rnd() < def.splitA ? 'a' : 'b';
    const amt = [25, 50, 100, 250, 500, 1000, 2500, 5000][Math.floor(rnd() * 8)] ?? 100;
    const who = NAMES[Math.floor(rnd() * NAMES.length)] ?? '7f3…9Aa';
    items.push({
      id: `back-${i}`,
      ts,
      kind: 'back',
      side,
      amountUsd: amt,
      text: `${who} backed ${side === 'a' ? symbols[0] : symbols[1]} with $${amt.toLocaleString('en-US')}`,
    });
  }
  // lead changes: sample the paths every 15 minutes
  let leader: SideKey | null = null;
  for (let t = 900; t <= duration; t += 900) {
    const a = pathA.at(t);
    const b = pathB.at(t);
    const cur: SideKey = a >= b ? 'a' : 'b';
    if (leader !== null && cur !== leader && Math.abs(a - b) > 0.15) {
      items.push({
        id: `lead-${t}`,
        ts: startTs + t,
        kind: 'lead',
        side: cur,
        text: `${cur === 'a' ? symbols[0] : symbols[1]} took the lead`,
      });
    }
    leader = cur;
  }
  items.push({
    id: 'cutoff',
    ts: backingCloseTs,
    kind: 'cutoff',
    text: 'Backing closed. Positions are locked in until the end.',
  });
  if (backingCloseTs - 600 > startTs) {
    items.push({
      id: 'cutoff-10',
      ts: backingCloseTs - 600,
      kind: 'cutoff',
      text: 'Backing closes in 10m',
    });
  }
  items.push({
    id: 'end',
    ts: endTs,
    kind: 'settle',
    text: 'Arena ended. Settling on Pyth prices.',
  });
  return items
    .filter((it) => it.ts <= now)
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 30);
}

export function buildFixtureArena(def: FixtureDef, now: number): ArenaView {
  const A = findAsset(def.a);
  const B = findAsset(def.b);
  if (!A || !B) throw new Error(`fixture ${def.slug}: unknown asset`);
  const { startTs, endTs, cycle } = schedule(def, now);
  const duration = endTs - startTs;
  const seed = hashSeed(`${def.slug}#${cycle}`);
  const pathA = makePath(seed ^ 0x1234, def.targetA, def.volA, duration);
  const pathB = makePath(seed ^ 0x5678, def.targetB, def.volB, duration);
  const params = DEFAULT_ARENA_PARAMS;
  const holdSecs = Math.max((duration * params.minHoldBps) / 10_000, params.minHoldFloorSecs);
  const backingCloseTs = endTs - holdSecs;
  const warmup = Number(warmupSecs(BigInt(duration), params.underdog));

  let status: ArenaStatus;
  if (def.kind === 'cancelled') status = 'cancelled';
  else if (def.kind === 'settled') status = 'settled';
  else if (now < startTs) status = 'scheduled';
  else if (now >= endTs) status = now < endTs + 20 * 60 ? 'settling' : 'settled';
  else if (now >= backingCloseTs) status = 'backing_closed';
  else status = 'live';

  // clock used for the performance path: frozen at end for finished Arenas
  const elapsed = Math.max(0, Math.min(now, endTs) - startTs);
  const perfA = status === 'scheduled' || status === 'cancelled' ? 0 : round2(pathA.at(elapsed));
  const perfB = status === 'scheduled' || status === 'cancelled' ? 0 : round2(pathB.at(elapsed));

  // backing grows with elapsed time (fast early, then steady), deterministic
  const growth =
    status === 'scheduled' ? 0 : Math.min(1, 0.35 + 0.65 * Math.pow(elapsed / duration, 0.6));
  const totalBacking = Math.round(def.backingUsd * growth);
  const participants = Math.round(def.participants * growth);
  const backA = Math.round(totalBacking * def.splitA);
  const backB = totalBacking - backA;
  const shareA = totalBacking > 0 ? backA / totalBacking : 0.5;

  // underdog multiplier for a new small deposit on each side (ECONOMICS §7)
  const mult = (share: number): number => {
    if (status !== 'live') return 1;
    const raw = rawMultiplierQ4(BigInt(Math.round(share * 10_000)), params.underdog);
    const m = rampMultiplierQ4(raw, BigInt(Math.max(0, elapsed)), BigInt(warmup));
    return Number(m) / Number(ONE_Q4);
  };

  const fees = totalBacking * 0.005 * 0.4; // 40 % of the 0.50 % fee goes to the pool
  const rewardPool = Math.round(def.sponsorUsd + fees);

  const priceA = REF_PRICE[def.a] ?? 1;
  const priceB = REF_PRICE[def.b] ?? 1;
  const sides: [ArenaSideView, ArenaSideView] = [
    {
      key: 'a',
      asset: identity(A),
      startPrice: priceA,
      price: priceA * (1 + perfA / 100),
      perfPct: perfA,
      backingUsd: backA,
      backingShare: shareA,
      participants: Math.round(participants * shareA),
      multiplier: mult(shareA),
    },
    {
      key: 'b',
      asset: identity(B),
      startPrice: priceB,
      price: priceB * (1 + perfB / 100),
      perfPct: perfB,
      backingUsd: backB,
      backingShare: 1 - shareA,
      participants: participants - Math.round(participants * shareA),
      multiplier: mult(1 - shareA),
    },
  ];

  const diff = round2(perfA - perfB);
  const leader: SideKey | 'tie' = Math.abs(diff) < 0.005 ? 'tie' : diff > 0 ? 'a' : 'b';

  // history: up to ~120 points from start to the frozen clock
  const history: PerfPoint[] = [];
  if (status !== 'scheduled' && status !== 'cancelled') {
    const points = 120;
    const step = Math.max(60, Math.floor(elapsed / points));
    for (let t = 0; t <= elapsed; t += step) {
      history.push({ t: startTs + t, a: round2(pathA.at(t)), b: round2(pathB.at(t)) });
    }
    const last = history[history.length - 1];
    if (!last || last.t !== startTs + elapsed)
      history.push({ t: startTs + elapsed, a: perfA, b: perfB });
  }

  const view: ArenaView = {
    id: `demo:${def.slug}`,
    slug: def.slug,
    provenance: 'demo',
    status,
    category: def.category,
    narrative: def.narrative,
    featured: def.featured ?? false,
    trending: def.trending ?? false,
    startTs,
    endTs,
    backingCloseTs,
    warmupSecs: warmup,
    sides,
    leader,
    leadPct: Math.abs(diff),
    totalBackingUsd: totalBacking,
    participants,
    rewardPoolUsd: rewardPool,
    sponsorUsd: def.sponsorUsd,
    feeBps: 50,
    creator: def.creator,
    history,
    activity:
      status === 'scheduled' || status === 'cancelled'
        ? status === 'cancelled'
          ? [
              {
                id: 'cancel',
                ts: startTs + 3 * H,
                kind: 'settle',
                text: 'Arena cancelled: start price could not be verified. Everything is withdrawable.',
              },
            ]
          : []
        : buildActivity(
            def,
            seed,
            startTs,
            endTs,
            backingCloseTs,
            Math.min(now, endTs),
            [sides[0].asset.symbol, sides[1].asset.symbol],
            pathA,
            pathB,
            duration,
          ),
    market: null,
  };
  if (status === 'settled') view.winner = leader;
  return view;
}

export function listFixtureArenas(now: number): ArenaView[] {
  return FIXTURE_DEFS.map((d) => buildFixtureArena(d, now));
}

export function findFixtureDef(slug: string): FixtureDef | undefined {
  return FIXTURE_DEFS.find((d) => d.slug === slug);
}
